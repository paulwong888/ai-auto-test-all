"""SIM / 服务信息阶段（SELECT_SIM + SIGN 子步）。"""
from __future__ import annotations

import re
import time
from typing import Literal

from playwright.sync_api import Locator, Page, expect

from data.offer_factory import get_multi_sim_line_count
from data import sim_factory
from data.sim_factory import (
    allocate_sim_pair,
    allocate_sim_pairs,
    get_handset_imei,
    mark_sim_attempt_failed,
    should_track_sim_usage,
)
from pages.activation_date_page import ActivationDatePage
from pages.overlay_helpers import (
    click_cart_footer_next_chevron,
    complete_otp_if_present,
    dismiss_shop_cart_drawer,
    is_iccid_only_sim_plan,
    is_multi_sim_order,
)
from pages.phone_selection_page import (
    CHANNEL_NUMBER_LABEL_RE,
    SECONDARY_SIM_PHONE_RE,
    PhoneSelectionPage,
)
from pages.signature_dialog import INLINE_STROKE_RATIOS, stroke_canvas

TERMS_PATTERN = re.compile(r"I have read and agree", re.I)
PRIMARY_SIM_PATTERN = re.compile(r"PRIMARY\s+SIM\s*&\s*Device", re.I)
SECONDARY_SIM_PATTERN = SECONDARY_SIM_PHONE_RE
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
        self.last_sim_pairs: list[tuple[str, str]] = []
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

    def _is_secondary_sim_url(self) -> bool:
        return "secondarysim" in (self.page.url or "").lower()

    def _secondary_line_context(self) -> bool:
        return self._is_secondary_sim_url() or bool(
            SECONDARY_SIM_PHONE_RE.search(self._body_text())
        )

    def _multi_sim_substep_hint(self) -> str:
        body = (self._body_text() or "")[:280].replace("\n", " ")
        return (
            f"url={self.page.url!r} "
            f"channel0={self._is_channel_number_substep(0)} "
            f"channel1={self._is_channel_number_substep(1)} "
            f"iccid_view={self._is_iccid_entry_view()} "
            f"dedicated_iccid={self._dedicated_iccid_input_visible()} "
            f"body≈{body!r}"
        )

    def _dedicated_iccid_input_visible(self) -> bool:
        """选号子步的 #hkMobile 不算 ICCID 录入。"""
        hk = self.page.locator("#hkMobile")
        for box in self._visible_textboxes():
            try:
                el_id = box.get_attribute("id") or ""
                if el_id == "hkMobile":
                    continue
                aria = (box.get_attribute("aria-label") or "").lower()
                if "mobile" in aria and "iccid" not in aria:
                    continue
                return True
            except Exception:
                return True
        if re.search(r"Handset\s+IMEI|ICCID", self._body_text(), re.I):
            inputs = self._iccid_imsi_inputs()
            if inputs is None:
                return False
            iccid, _imsi = inputs
            if hk.count() > 0:
                try:
                    if iccid == hk.first:
                        return False
                except Exception:
                    pass
            return True
        return False

    def _is_channel_number_substep(self, line_index: int = 0) -> bool:
        """SELECT_SIM 内 Secondary 等 Channel Number 池（尚未到 ICCID 屏）。"""
        if ActivationDatePage(self.page).is_activation_step():
            return False
        url_secondary = line_index > 0 and self._is_secondary_sim_url()
        body_has_channel = bool(CHANNEL_NUMBER_LABEL_RE.search(self._body_text()))
        if not body_has_channel and not url_secondary:
            return False
        if line_index > 0 and not self._secondary_line_context() and not url_secondary:
            return False
        phone = PhoneSelectionPage(self.page)
        has_pool = (
            phone._channel_number_entries(line_index).count() > 0
            or phone._phone_cards().count() > 0
        )
        if not has_pool and not url_secondary:
            return False
        return not self._dedicated_iccid_input_visible()

    def _is_iccid_entry_view(self) -> bool:
        if self._is_channel_number_substep(0) or self._is_channel_number_substep(1):
            return False
        if self._is_secondary_sim_url() and not self._dedicated_iccid_input_visible():
            return False
        if ICCID_ENTRY_PATTERN.search(self._body_text()):
            if self._is_secondary_sim_url() and not re.search(
                r"Handset\s+IMEI|ICCID", self._body_text(), re.I
            ):
                return self._dedicated_iccid_input_visible()
            return True
        return self._dedicated_iccid_input_visible()

    def _wait_for_secondary_channel_substep(self, timeout_ms: int = 45_000) -> None:
        """Primary ICCID + ``>`` 后应进入 Secondary Channel Number 子步。"""
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            if self._is_channel_number_substep(1):
                return
            if self._loading_overlay_visible():
                self._wait_sim_step_idle(timeout_ms=min(15_000, int((deadline - time.monotonic()) * 1000)))
            self.page.wait_for_timeout(400)
        raise AssertionError(
            "Primary ICCID 后未进入 Secondary Channel Number 子步。"
            f" {self._multi_sim_substep_hint()}"
        )

    def _on_secondary_activation_date_step(self) -> bool:
        url = (self.page.url or "").lower()
        if "select-date" in url and "secondarysim" in url:
            return True
        activation = ActivationDatePage(self.page)
        return activation.is_activation_step() and self._secondary_line_context()

    def _advance_past_activation_if_on_sim_wizard(self) -> bool:
        """Secondary 选号 + ``>`` 后：Activation Date → 购物车 ``>`` → ICCID。"""
        if not self._on_secondary_activation_date_step():
            activation = ActivationDatePage(self.page)
            if not activation.is_activation_step() or not is_multi_sim_order(self.page):
                return False
        activation = ActivationDatePage(self.page)
        url_before = self.page.url or ""
        print("[sim_service] Secondary Activation Date → cart chevron only")
        activation.advance_past_activation_date(pick_first_cell=False)
        self._wait_sim_step_idle(timeout_ms=15_000)
        still_on_date = (
            self._on_secondary_activation_date_step()
            or activation.is_activation_step()
        )
        if still_on_date and (self.page.url or "") == url_before:
            print("[sim_service] Activation Date retry: pick cell + cart chevron")
            activation.advance_past_activation_date(pick_first_cell=True)
        self._wait_sim_step_idle(timeout_ms=30_000)
        return True

    def _wait_for_secondary_iccid_substep(self, timeout_ms: int = 60_000) -> None:
        """Secondary 选号 + ``>`` 后应进入 Secondary ICCID 录入。"""
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            if self._is_iccid_entry_view() and self._dedicated_iccid_input_visible():
                return
            if self._advance_past_activation_if_on_sim_wizard():
                continue
            if self._loading_overlay_visible():
                self._wait_sim_step_idle(timeout_ms=min(15_000, int((deadline - time.monotonic()) * 1000)))
            self.page.wait_for_timeout(400)
        raise AssertionError(
            "Secondary 选号后未进入 ICCID 录入子步。"
            f" {self._multi_sim_substep_hint()}"
        )

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

    def _advance_sim_substep_via_cart_footer(self) -> None:
        """SELECT_SIM 子步前进：优先底部购物车条右侧 ``>``，少滚长表单。"""
        dismiss_shop_cart_drawer(self.page)
        if click_cart_footer_next_chevron(self.page):
            self.page.wait_for_load_state("networkidle")
            self._wait_sim_step_idle()
            return
        print("[sim_service] cart footer chevron missed, fallback flex-body")
        self._click_forward_chevron()

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
        found = self._find_terms_checkbox()
        if found is not None:
            return found
        return self.page.get_by_role(
            "checkbox", name=re.compile(r"I have read and agree", re.I)
        ).first

    def _find_terms_checkbox(self) -> Locator | None:
        for i in range(self.page.get_by_role("tabpanel").count()):
            panel = self.page.get_by_role("tabpanel").nth(i)
            for pattern in (TERMS_PATTERN, re.compile(r"I have read and agree", re.I)):
                cb = panel.get_by_role("checkbox", name=pattern)
                if cb.count() == 0:
                    continue
                try:
                    if cb.first.is_visible():
                        return cb.first
                except Exception:
                    return cb.first
        for pattern in (TERMS_PATTERN, re.compile(r"I have read and agree", re.I)):
            cb = self.page.get_by_role("checkbox", name=pattern)
            if cb.count() > 0:
                try:
                    if cb.first.is_visible():
                        return cb.first
                except Exception:
                    return cb.first
        return None

    def _sim_tab_names_for_terms(self) -> list[str | None]:
        if not is_multi_sim_order(self.page) or get_multi_sim_line_count() <= 1:
            return [None]
        return ["Primary", "Secondary"]

    def _activate_sim_tab(self, tab_name: str) -> None:
        tab = self.page.get_by_role("tab", name=re.compile(rf"^{tab_name}$", re.I))
        if tab.count() > 0:
            tab.first.click(force=True)
            self.page.wait_for_timeout(400)

    def _advance_until_terms_visible(self, rounds: int = 5) -> None:
        for _ in range(rounds):
            if self._find_terms_checkbox() is not None:
                return
            if self._is_ssa_terms_view():
                self._click_terms_expand_icon()
                self.page.wait_for_timeout(500)
                if self._find_terms_checkbox() is not None:
                    return
            if self._is_iccid_entry_view() or not self._is_ssa_terms_view():
                self._advance_sim_substep_via_cart_footer()
                self._wait_sim_step_idle(timeout_ms=15_000)
                continue
            self.page.wait_for_timeout(500)

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

    def _dismiss_sim_blocking_dialogs(self) -> None:
        """ICCID blur 校验失败时 Portal 常弹 p-dialog / toast，先关掉以免挡输入。"""
        complete_otp_if_present(self.page)
        for _ in range(3):
            dialog = self.page.get_by_role("dialog").filter(
                has_text=re.compile(r"ICCID|serial|SIM|inventory|error|fail", re.I)
            )
            if dialog.count() == 0 or not dialog.first.is_visible():
                break
            for label in ("OK", "Close", "Confirm", "確定"):
                btn = dialog.first.get_by_role("button", name=re.compile(label, re.I))
                if btn.count() > 0 and btn.first.is_visible():
                    btn.first.click(force=True)
                    self.page.wait_for_timeout(400)
                    break
            else:
                self.page.keyboard.press("Escape")
            self.page.wait_for_timeout(300)

    def _fill_iccid_only(
        self, iccid: Locator, iccid_val: str, *, idle_timeout_ms: int = 60_000
    ) -> None:
        """单 ICCID 字段，blur 触发库存校验（new-select-sim updateOn: blur）。"""
        self._dismiss_sim_blocking_dialogs()
        iccid.click()
        iccid.fill("")
        iccid.fill(iccid_val)
        iccid.press("Tab")
        self.page.wait_for_load_state("networkidle")
        self._wait_sim_step_idle(timeout_ms=idle_timeout_ms)
        self._dismiss_sim_blocking_dialogs()
        if self._iccid_error_visible():
            print(f"[sim_service] ICCID inventory error after fill: {iccid_val!r}")

    def _fill_iccid_and_advance_sim_only(self, iccid: Locator, iccid_val: str) -> None:
        """Sim Only / Multi：填 ICCID → 校验转圈结束 → 购物车条 ``>``（不填 IMEI）。"""
        self._fill_iccid_only(iccid, iccid_val, idle_timeout_ms=20_000)
        if not self._iccid_error_visible():
            self._advance_sim_substep_via_cart_footer()

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
        if "select-phone" in (self.page.url or "").lower():
            raise AssertionError(
                "不应在 SELECT_PHONE（含 secondarySim）填 ICCID；"
                f"当前 url={self.page.url!r}"
            )
        imsi_val = get_handset_imei()
        self._capture_sim_error_baseline()
        sim_only = is_iccid_only_sim_plan(self.page)
        inputs = self._iccid_imsi_inputs()
        if inputs is None:
            single = self._single_iccid_input()
            if single is None:
                raise AssertionError("SIM 步找不到 ICCID 输入框")
            if sim_only:
                self._fill_iccid_and_advance_sim_only(single, iccid_val)
            else:
                self._fill_iccid_only(single, iccid_val)
            return
        iccid, imsi = inputs
        if sim_only:
            self._fill_iccid_and_advance_sim_only(iccid, iccid_val)
            return
        if iccid == imsi or self._visible_textbox_count() == 1:
            self._fill_iccid_only(iccid, iccid_val)
        else:
            self._fill_iccid_imsi_recording_style(iccid, imsi, iccid_val, imsi_val)

    def _try_fill_pair_sim_only(self, iccid_val: str, imsi_val: str) -> FillResult:
        """Sim Only：ICCID 已在 apply 中点 ``>``，跳过 ICCID 同屏 terms 轮询。"""
        self._wait_sim_step_idle(timeout_ms=15_000)
        result = self._wait_terms_enabled(rounds=50)
        if result == "accepted":
            return result
        if self._loading_overlay_visible():
            self._wait_sim_step_idle(timeout_ms=30_000)
            result = self._wait_terms_enabled(rounds=40)
            if result == "accepted":
                return result
        return self._recover_terms_for_iccid(iccid_val, imsi_val)

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

        if is_iccid_only_sim_plan(self.page):
            return self._try_fill_pair_sim_only(iccid_val, imsi_val)

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

    def _complete_channel_number_for_line(self, line_index: int) -> None:
        """Multi-SIM：Channel Number / Shop 池选首项 → ``>`` 进入 ICCID 子步。"""
        if not self._is_channel_number_substep(line_index):
            if line_index > 0 and self._is_secondary_sim_url():
                pass
            else:
                return
        phone = PhoneSelectionPage(self.page)
        dismiss_shop_cart_drawer(self.page)
        phone._activate_new_number_tab()
        phone._clear_mobile_input_if_invalid()
        hk = phone._hk_mobile_input()
        if hk.count() > 0:
            try:
                raw = hk.first.input_value() or ""
                digits = re.sub(r"\D", "", raw)
                if len(digits) > 8:
                    hk.first.click()
                    hk.first.fill("")
                    hk.first.press("Tab")
                    self.page.wait_for_timeout(300)
            except Exception:
                pass
        if line_index > 0 and not (
            self._is_secondary_sim_url() or self._is_channel_number_substep(line_index)
        ):
            phone._focus_phone_line(line_index)
        picked = phone._select_channel_number_for_line(line_index)
        if not picked and phone._wait_shop_mobile_cards(timeout_ms=12_000):
            picked = phone._select_first_shop_phone_card()
        if not picked:
            snippet = (self._body_text() or "")[:350].replace("\n", " ")
            raise AssertionError(
                f"Multi-SIM line {line_index + 1} Channel Number 池可见但未能选号。"
                f" url={self.page.url!r} body≈{snippet!r}"
            )
        digits = phone._hk_mobile_value()
        if len(digits) != 8:
            raise AssertionError(
                f"Multi-SIM line {line_index + 1} 选号后 #hkMobile 须 8 位，当前={digits!r}"
            )
        phone._assert_hk_phone_mnms_ok(digits)
        phone._assert_no_invalid_mobile_error()
        print("[sim_service] Secondary Channel 已选号 → cart chevron 进入 Activation Date")
        self._advance_sim_substep_via_cart_footer()
        self._wait_sim_step_idle(timeout_ms=30_000)
        if self._on_secondary_activation_date_step():
            self._advance_past_activation_if_on_sim_wizard()

    def _focus_sim_line(self, line_index: int) -> None:
        """Multi-SIM：切换 Primary / Secondary 等 SIM line。"""
        if line_index <= 0:
            label = PRIMARY_SIM_PATTERN
        else:
            label = SECONDARY_SIM_PATTERN
        hit = self.page.get_by_text(label)
        for i in range(hit.count()):
            candidate = hit.nth(i)
            try:
                if candidate.is_visible():
                    candidate.scroll_into_view_if_needed()
                    candidate.click(force=True)
                    self.page.wait_for_timeout(400)
                    return
            except Exception:
                candidate.click(force=True)
                self.page.wait_for_timeout(400)
                return

    def _fill_one_line_iccid_only(self, iccid_val: str, imsi_val: str) -> FillResult:
        if not self._ensure_iccid_entry_view():
            return "ui_not_ready"
        try:
            self._apply_iccid_values(iccid_val, imsi_val)
        except AssertionError:
            return "ui_not_ready"
        if self._iccid_error_visible():
            return "invalid_iccid"
        self._wait_sim_step_idle(timeout_ms=15_000)
        return "accepted"

    def _fill_one_multi_line_iccid(
        self,
        line_idx: int,
        line_count: int,
        pending_pairs: list[tuple[str, str]],
        *,
        max_attempts: int,
    ) -> str:
        line_ok = False
        iccid_val, imsi_val = pending_pairs[line_idx]
        for attempt in range(max_attempts):
            print(
                f"[sim_service] multi line {line_idx + 1}/{line_count} "
                f"try ICCID={iccid_val} attempt={attempt + 1}"
            )
            result = self._fill_one_line_iccid_only(iccid_val, imsi_val)
            if result == "accepted":
                self.last_sim_pairs.append((iccid_val, imsi_val))
                line_ok = True
                return iccid_val
            if result == "invalid_iccid":
                self._discard_iccid(iccid_val, "invalid:inventory_error")
                sim_factory._allocation = None  # noqa: SLF001
                iccid_val, imsi_val = allocate_sim_pair()
                pending_pairs[line_idx] = (iccid_val, imsi_val)
                continue
            raise AssertionError(
                f"Multi-SIM line {line_idx + 1} ICCID 录入 UI 未就绪。"
                f" {_multi_sim_substep_hint()}"
            )
        if not line_ok:
            raise AssertionError(
                f"Multi-SIM line {line_idx + 1} 无可用 ICCID（已试 {max_attempts} 次）。"
            )
        return iccid_val

    def _fill_sim_ids_multi_line(self, line_count: int) -> tuple[str, str]:
        """Primary ICCID → ``>`` → Secondary Channel → ``>`` → Secondary ICCID。"""
        self.last_sim_pairs = []
        max_attempts = 15 if should_track_sim_usage() else 1
        line_iccids: list[str] = []
        pending_pairs = allocate_sim_pairs(line_count)

        self._wait_sim_step_idle(timeout_ms=15_000)
        if self._is_channel_number_substep(0):
            self._complete_channel_number_for_line(0)
        elif self._is_iccid_entry_view():
            self._focus_sim_line(0)

        line_iccids.append(
            self._fill_one_multi_line_iccid(
                0, line_count, pending_pairs, max_attempts=max_attempts
            )
        )

        if line_count >= 2:
            self._wait_for_secondary_channel_substep()
            self._complete_channel_number_for_line(1)
            self._wait_for_secondary_iccid_substep()
            line_iccids.append(
                self._fill_one_multi_line_iccid(
                    1, line_count, pending_pairs, max_attempts=max_attempts
                )
            )

        for line_idx in range(2, line_count):
            self._focus_sim_line(line_idx)
            self._wait_sim_step_idle(timeout_ms=15_000)
            self._complete_channel_number_for_line(line_idx)
            line_iccids.append(
                self._fill_one_multi_line_iccid(
                    line_idx, line_count, pending_pairs, max_attempts=max_attempts
                )
            )

        self._wait_sim_step_idle(timeout_ms=15_000)
        if self._is_iccid_entry_view():
            self._advance_sim_substep_via_cart_footer()
            self._wait_sim_step_idle(timeout_ms=15_000)

        self.last_sim_pair = self.last_sim_pairs[-1]
        sim_factory._multi_line_pairs = list(self.last_sim_pairs)
        print(f"[sim_service] multi accepted ICCIDs={line_iccids}")
        return self.last_sim_pair

    def fill_sim_ids(self, *, lines: int = 1) -> tuple[str, str]:
        """从 pool 取 ICCID；Multi-SIM 可填多 line（仅 ICCID）。"""
        dismiss_shop_cart_drawer(self.page)
        expect(
            self.page.get_by_text(re.compile(r"PRIMARY\s+SIM|SIM\s*&\s*Device|PRIMARY", re.I)).first
        ).to_be_visible(timeout=30_000)

        line_count = lines
        if is_multi_sim_order(self.page) and lines <= 1:
            line_count = get_multi_sim_line_count()
        if line_count > 1:
            return self._fill_sim_ids_multi_line(line_count)

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
        self._advance_until_terms_visible()

        for tab_name in self._sim_tab_names_for_terms():
            if tab_name:
                self._activate_sim_tab(tab_name)
                self._wait_sim_step_idle(timeout_ms=15_000)

            terms = self._find_terms_checkbox()
            if terms is None:
                if self._is_iccid_entry_view():
                    self._advance_sim_substep_via_cart_footer()
                    self._wait_sim_step_idle(timeout_ms=15_000)
                self._click_terms_expand_icon()
                terms = self._find_terms_checkbox()

            if terms is None:
                snippet = (self._body_text() or "")[:320].replace("\n", " ")
                raise AssertionError(
                    "Multi-SIM 条款 checkbox 未找到或未 enabled。"
                    f" tab={tab_name!r} url={self.page.url!r} body≈{snippet!r}"
                )

            try:
                if terms.is_checked():
                    continue
            except Exception:
                pass

            expect(terms).to_be_enabled(timeout=60_000)
            terms.check(force=True)
            expect(terms).to_be_checked()

    def sign_consent(self) -> None:
        """SSA 条款 canvas 签名（Multi-SIM 按 Primary / Secondary tab）。"""
        self._wait_sim_step_idle()
        for tab_name in self._sim_tab_names_for_terms():
            if tab_name:
                self._activate_sim_tab(tab_name)
                self._wait_sim_step_idle(timeout_ms=15_000)
            section = self.page.locator(".flex-body").filter(has_text=SSA_VIEW_PATTERN)
            canvas = (
                section.locator("canvas:visible").last
                if section.count() > 0
                else self.page.locator(".flex-body canvas:visible").last
            )
            if canvas.count() == 0 or not canvas.is_visible():
                continue
            stroke_canvas(canvas, INLINE_STROKE_RATIOS, force=True)
            self._wait_sim_step_idle(timeout_ms=60_000)
