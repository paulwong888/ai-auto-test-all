"""SIM / 服务信息阶段（SELECT_SIM + SIGN 子步）。"""
from __future__ import annotations

import re
import time
from typing import Literal

from playwright.sync_api import Locator, Page, expect

from data.sim_factory import (
    allocate_sim_pair,
    get_handset_imei,
    mark_sim_attempt_failed,
    should_track_sim_usage,
)
from pages.overlay_helpers import dismiss_shop_cart_drawer
from pages.signature_dialog import INLINE_STROKE_RATIOS, stroke_canvas

TERMS_PATTERN = re.compile(r"I have read and agree", re.I)
PRIMARY_SIM_PATTERN = re.compile(r"PRIMARY\s+SIM\s*&\s*Device", re.I)
ICCID_ENTRY_PATTERN = re.compile(r"Handset\s+IMEI|Mobile number|SIM\s*&\s*Device", re.I)
SSA_VIEW_PATTERN = re.compile(r"SSA Image|Please sign here", re.I)
ICCID_ERROR_PATTERN = re.compile(
    r"ICCID was not found|not found in SIM inventory|invalid.*ICCID|already been used|"
    r"does not exist|unable to find|"
    r"serial\s*no\s*:?\s*\d+\s*not\s*available|serial.*not\s*available|"
    r"ICCID.*not\s*valid|not\s*valid.*ICCID",
    re.I,
)

FillResult = Literal["accepted", "invalid_iccid", "ui_not_ready", "terms_pending"]


class SimServicePage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.last_sim_pair: tuple[str, str] | None = None
        self._sim_error_baseline: str = ""

    def _body_text(self) -> str:
        return self.page.locator("body").inner_text()

    def _sim_step_root(self) -> Locator:
        body = self.page.locator(".flex-body")
        for section in (
            body.filter(has_text=PRIMARY_SIM_PATTERN),
            body.filter(has_text=ICCID_ENTRY_PATTERN),
            body,
        ):
            if section.count() > 0:
                return section.first
        return body.first

    def _sim_region_text(self) -> str:
        try:
            return self._sim_step_root().inner_text()
        except Exception:
            return self._body_text()

    def _capture_sim_error_baseline(self) -> None:
        self._sim_error_baseline = self._sim_region_text()

    def _iccid_error_snippets(self, text: str) -> list[str]:
        return [m.group(0).strip() for m in ICCID_ERROR_PATTERN.finditer(text)]

    def _new_iccid_inventory_errors(self) -> list[str]:
        current = self._sim_region_text()
        baseline = set(self._iccid_error_snippets(self._sim_error_baseline))
        fresh = [s for s in self._iccid_error_snippets(current) if s not in baseline]
        for sel in (".p-message-error:visible", ".p-inline-message:visible", "[role='alert']:visible"):
            loc = self._sim_step_root().locator(sel)
            if loc.count() == 0:
                continue
            snippet = loc.first.inner_text().strip()
            if snippet and ICCID_ERROR_PATTERN.search(snippet) and snippet not in baseline:
                if snippet not in fresh:
                    fresh.append(snippet)
        return fresh

    def _iccid_field_value(self) -> str:
        single = self._single_iccid_input()
        if single is not None:
            try:
                return (single.input_value() or "").strip()
            except Exception:
                pass
        inputs = self._iccid_imsi_inputs()
        if inputs is not None:
            try:
                return (inputs[0].input_value() or "").strip()
            except Exception:
                pass
        return ""

    def _loading_overlay_visible(self) -> bool:
        for sel in (
            ".p-progress-spinner:visible",
            ".p-blockui:visible",
            ".p-blockui-document:visible",
            ".flex-body .pi-spinner:visible",
            ".p-datatable-loading-overlay:visible",
            "app-crm-loading:visible",
        ):
            if self.page.locator(sel).count() > 0:
                return True
        return False

    def _wait_sim_step_idle(self, timeout_ms: int = 90_000) -> None:
        """ICCID 校验 / SSA 子步切换时的转圈，结束后再做视图判断。"""
        stable = 0
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            if self._loading_overlay_visible():
                stable = 0
                self.page.wait_for_timeout(400)
                continue
            stable += 1
            if stable >= 2:
                return
            self.page.wait_for_timeout(300)

    def _visible_textboxes(self, root: Locator | None = None) -> list[Locator]:
        scope = root or self.page.locator(".flex-body")
        boxes = scope.get_by_role("textbox")
        visible: list[Locator] = []
        for i in range(boxes.count()):
            box = boxes.nth(i)
            if box.is_visible():
                visible.append(box)
        return visible

    def _visible_textbox_count(self, root: Locator | None = None) -> int:
        return len(self._visible_textboxes(root))

    def _is_iccid_entry_view(self) -> bool:
        if ICCID_ENTRY_PATTERN.search(self._body_text()):
            return True
        return self._visible_textbox_count() >= 1

    def _is_ssa_terms_view(self) -> bool:
        if not SSA_VIEW_PATTERN.search(self._body_text()):
            return False
        return self._visible_textbox_count() == 0

    def _ensure_iccid_entry_view(self) -> bool:
        """仅在为换 ICCID 重填时退回录入视图；转圈中不做回退。"""
        if self._loading_overlay_visible():
            self._wait_sim_step_idle()
        if self._is_iccid_entry_view():
            return True
        if not self._is_ssa_terms_view():
            return self._is_iccid_entry_view()
        back = self.page.locator(".flex-body .pi.pi-chevron-left:visible").first
        if back.count() == 0:
            back = self.page.locator(".pi.pi-chevron-left:visible").first
        if back.count() == 0:
            return False
        back.click(force=True)
        self._wait_sim_step_idle()
        return self._is_iccid_entry_view()

    def _click_forward_chevron(self) -> None:
        chev = self.page.locator(".flex-body .pi.pi-chevron-right:visible").first
        if chev.count() == 0:
            return
        chev.scroll_into_view_if_needed()
        chev.click(force=True)
        self.page.wait_for_load_state("networkidle")
        self._wait_sim_step_idle()

    def _iccid_imsi_inputs(self) -> tuple[Locator, Locator] | None:
        body = self.page.locator(".flex-body")
        for section in (
            body.filter(has_text=PRIMARY_SIM_PATTERN),
            body.filter(has_text=ICCID_ENTRY_PATTERN),
            body,
        ):
            if section.count() == 0:
                continue
            visible = self._visible_textboxes(section.first)
            if len(visible) >= 2:
                return visible[0], visible[1]
            if len(visible) == 1:
                second = self.page.get_by_role("textbox").nth(1)
                if second.count() > 0 and second.is_visible():
                    return visible[0], second
        return None

    def _single_iccid_input(self) -> Locator | None:
        body = self.page.locator(".flex-body")
        for section in (
            body.filter(has_text=PRIMARY_SIM_PATTERN),
            body.filter(has_text=ICCID_ENTRY_PATTERN),
            body,
        ):
            if section.count() == 0:
                continue
            visible = self._visible_textboxes(section.first)
            if len(visible) == 1:
                return visible[0]
        visible = self._visible_textboxes()
        if len(visible) == 1:
            return visible[0]
        return None

    def _terms_checkbox(self) -> Locator:
        terms = self.page.get_by_role("checkbox", name=TERMS_PATTERN)
        if terms.count() > 0:
            return terms.first
        return self.page.get_by_role(
            "checkbox", name=re.compile(r"I have read and agree", re.I)
        ).first

    def _iccid_error_visible(self) -> bool:
        """仅 SIM 区内、相对 baseline 新增的 inventory 报错（避免误伤旧文案）。"""
        fresh = self._new_iccid_inventory_errors()
        if fresh:
            print(f"[sim_service] new ICCID error: {fresh[0]!r}")
        return bool(fresh)

    def _click_terms_expand_icon(self) -> None:
        """录制：填完 ICCID 后、勾条款前点击 i.nth(5)。"""
        section = self.page.locator(".flex-body").filter(has_text=re.compile(r"PRIMARY", re.I))
        icon = section.locator("i").nth(5) if section.count() > 0 else self.page.locator("i").nth(5)
        if icon.count() > 0 and icon.is_visible():
            icon.click()
            self.page.wait_for_timeout(400)

    def _fill_iccid_only(self, iccid: Locator, iccid_val: str) -> None:
        """5G BB 主模块：单 ICCID 字段，blur 触发库存校验（new-select-sim updateOn: blur）。"""
        iccid.click()
        iccid.fill("")
        iccid.fill(iccid_val)
        iccid.press("Tab")
        self.page.wait_for_load_state("networkidle")
        self._wait_sim_step_idle(timeout_ms=60_000)
        if self._iccid_error_visible():
            print(f"[sim_service] ICCID inventory error after fill: {iccid_val!r}")

    def _fill_iccid_imsi_recording_style(
        self, iccid: Locator, imsi: Locator, iccid_val: str, imsi_val: str
    ) -> None:
        """对齐录制：双点 ICCID → 点 IMEI → 再确认 ICCID → PRIMARY → 填固定 IMEI。"""
        imsi_val = get_handset_imei()
        iccid.click()
        iccid.click()
        iccid.fill("")
        iccid.fill(iccid_val)
        imsi.click()
        self.page.wait_for_timeout(200)
        iccid.click()
        iccid.fill(iccid_val)

        primary = self.page.get_by_text(re.compile(r"PRIMARY\s+SIM", re.I))
        if primary.count() > 0:
            primary.first.click(force=True)
            self.page.wait_for_timeout(400)

        imsi.click()
        imsi.click()
        imsi.fill("")
        imsi.fill(imsi_val)
        imsi.press("Tab")
        self.page.wait_for_load_state("networkidle")
        self._wait_sim_step_idle(timeout_ms=60_000)
        if self._iccid_error_visible():
            print(f"[sim_service] ICCID inventory error after fill: {iccid_val!r}")

    def _wait_terms_enabled(
        self, *, expand_retries: bool = True, rounds: int = 80
    ) -> FillResult:
        if expand_retries:
            self._click_terms_expand_icon()
        for i in range(rounds):
            if self._loading_overlay_visible():
                self._wait_sim_step_idle(timeout_ms=30_000)
            if self._iccid_error_visible():
                return "invalid_iccid"
            terms = self._terms_checkbox()
            if terms.count() > 0 and terms.is_enabled():
                return "accepted"
            if expand_retries and i in (6, 12, 18, 24, 36, 48):
                self._click_terms_expand_icon()
                primary = self.page.get_by_text(PRIMARY_SIM_PATTERN)
                if primary.count() > 0:
                    primary.first.click(force=True)
            self.page.wait_for_timeout(500)
        return "terms_pending"

    def _apply_iccid_values(self, iccid_val: str, imsi_val: str) -> None:
        imsi_val = get_handset_imei()
        self._capture_sim_error_baseline()
        inputs = self._iccid_imsi_inputs()
        if inputs is None:
            single = self._single_iccid_input()
            if single is None:
                raise AssertionError("SIM 步找不到 ICCID 输入框")
            self._fill_iccid_only(single, iccid_val)
            return
        iccid, imsi = inputs
        if iccid == imsi or self._visible_textbox_count() == 1:
            self._fill_iccid_only(iccid, iccid_val)
        else:
            self._fill_iccid_imsi_recording_style(iccid, imsi, iccid_val, imsi_val)

    def _recover_terms_for_iccid(self, iccid_val: str, imsi_val: str) -> FillResult:
        """条款未 enabled：同 ICCID 上 chevron/expand，不重复填号。"""
        for attempt in range(2):
            print(
                f"[sim_service] recover terms for ICCID={iccid_val}"
                f" attempt {attempt + 1}/2"
            )
            self._wait_sim_step_idle(timeout_ms=20_000)
            if self._iccid_error_visible():
                return "invalid_iccid"

            terms = self._terms_checkbox()
            if terms.count() > 0 and terms.is_enabled():
                return "accepted"

            if self._is_ssa_terms_view() and not self._is_iccid_entry_view():
                if not self._ensure_iccid_entry_view():
                    self._click_forward_chevron()
                    self._wait_sim_step_idle(timeout_ms=15_000)
                    continue

            if self._is_iccid_entry_view():
                if self._iccid_field_value() != iccid_val.strip():
                    self._apply_iccid_values(iccid_val, imsi_val)
                    if self._iccid_error_visible():
                        return "invalid_iccid"
                elif not self._is_ssa_terms_view():
                    self._click_forward_chevron()

            if not self._is_ssa_terms_view():
                self._click_forward_chevron()

            self._click_terms_expand_icon()
            result = self._wait_terms_enabled(rounds=40)
            if result != "terms_pending":
                return result

        return "terms_pending"

    def _try_fill_pair(self, iccid_val: str, imsi_val: str) -> FillResult:
        if not self._ensure_iccid_entry_view():
            if self._is_ssa_terms_view():
                terms = self._terms_checkbox()
                if terms.count() > 0 and terms.is_enabled():
                    return "accepted"
            return "ui_not_ready"

        try:
            self._apply_iccid_values(iccid_val, imsi_val)
        except AssertionError:
            return "ui_not_ready"

        if self._iccid_error_visible():
            return "invalid_iccid"

        result = self._wait_terms_enabled(rounds=40)
        if result == "accepted":
            return result

        if not self._is_ssa_terms_view():
            self._click_forward_chevron()
            result = self._wait_terms_enabled(rounds=80)
            if result == "accepted":
                return result

        if self._loading_overlay_visible():
            self._wait_sim_step_idle(timeout_ms=60_000)
            result = self._wait_terms_enabled(rounds=60)
            if result == "accepted":
                return result

        return self._recover_terms_for_iccid(iccid_val, imsi_val)

    def _discard_iccid(self, iccid: str, reason: str) -> None:
        """ICCID 报错：标记 sim_used 并换 pool 下一对。"""
        print(f"[sim_service] discard ICCID={iccid} reason={reason}")
        mark_sim_attempt_failed(iccid, reason=reason)

    def fill_sim_ids(self) -> tuple[str, str]:
        """从 pool 取 ICCID；报错即 mark used 并试下一对。"""
        dismiss_shop_cart_drawer(self.page)
        expect(
            self.page.get_by_text(re.compile(r"PRIMARY\s+SIM|SIM\s*&\s*Device|PRIMARY", re.I)).first
        ).to_be_visible(timeout=30_000)

        max_attempts = 15 if should_track_sim_usage() else 1
        tried: list[str] = []
        invalid: list[str] = []

        for _ in range(max_attempts):
            iccid_val, imsi_val = allocate_sim_pair()
            print(f"[sim_service] try ICCID={iccid_val}")
            tried.append(iccid_val)

            result = self._try_fill_pair(iccid_val, imsi_val)

            if result == "accepted":
                self.last_sim_pair = (iccid_val, imsi_val)
                print(f"[sim_service] accepted ICCID={iccid_val}")
                return self.last_sim_pair

            if result == "invalid_iccid":
                invalid.append(iccid_val)
                region = self._sim_region_text()
                reason = (
                    "serial_not_available"
                    if re.search(r"serial\s*no\s*:?\s*\d+\s*not\s*available", region, re.I)
                    else "inventory_error"
                )
                self._discard_iccid(iccid_val, f"invalid:{reason}")
                continue

            if result == "ui_not_ready":
                self._discard_iccid(iccid_val, "ui_not_ready")
                raise AssertionError(
                    "SIM 步无法回到 ICCID 录入视图（textbox 不可见）。"
                    f" 已尝试 ICCID: {', '.join(tried)}。"
                    " 请检查 VNC 预览是否停在 SSA/条款子步骤。"
                )

            print(f"[sim_service] terms error for ICCID={iccid_val}, mark used and try next")
            self._discard_iccid(iccid_val, "terms_error")
            continue

        raise AssertionError(
            "SIM 步 ICCID 均失败（已 mark used）。"
            f" 已尝试: {', '.join(tried)}。"
            f" inventory 无效: {', '.join(invalid) or '无'}。"
        )

    def agree_terms(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        self._wait_sim_step_idle()

        terms = self._terms_checkbox()
        if terms.count() == 0 or not terms.is_enabled():
            if self._is_iccid_entry_view() and not self._is_ssa_terms_view():
                self._click_forward_chevron()
            self._click_terms_expand_icon()
            terms = self._terms_checkbox()

        if terms.count() == 0 or not terms.is_enabled():
            self._wait_sim_step_idle(timeout_ms=120_000)
            self._click_terms_expand_icon()
            terms = self._terms_checkbox()

        expect(terms).to_be_enabled(timeout=60_000)
        terms.check(force=True)
        expect(terms).to_be_checked()

    def sign_consent(self) -> None:
        """SSA 条款 canvas 签名，完成后等待校验转圈结束。"""
        self._wait_sim_step_idle()
        section = self.page.locator(".flex-body").filter(has_text=SSA_VIEW_PATTERN)
        canvas = (
            section.locator("canvas:visible").last
            if section.count() > 0
            else self.page.locator(".flex-body canvas:visible").last
        )
        if canvas.count() == 0 or not canvas.is_visible():
            return
        stroke_canvas(canvas, INLINE_STROKE_RATIOS, force=True)
        self._wait_sim_step_idle(timeout_ms=90_000)
