"""SELECT_PHONE 步（new-select-phone）— Channel Number 列表 / Shop 号池 / 手输 MNMS。"""
from __future__ import annotations

import re
from typing import Literal

from playwright.sync_api import Locator, Page, expect

from data.offer_factory import get_sim_only_test_msisdn
from pages.activation_date_page import ActivationDatePage
from pages.order_application_page import OrderApplicationPage
from pages.overlay_helpers import click_cart_footer_next_chevron, dismiss_shop_cart_drawer

PHONE_STEP_RE = re.compile(
    r"selectPhone|Phone Number|HK Mobile|Shop Mobile|Channel Number|hkMobile", re.I
)
CHANNEL_NUMBER_LABEL_RE = re.compile(r"Channel Number", re.I)
KYC_STEP_RE = re.compile(r"Test ID number|Credit Check", re.I)
MOBILE_UNAVAILABLE_RE = re.compile(
    r"The mobile is unavailable|mobile is unavailable", re.I
)
SECONDARY_SIM_PHONE_RE = re.compile(
    r"SECONDARY\s*SIM|SECONDARYSIM|SIM\s*2|Add[\s-]?On\s+SIM", re.I
)
INVALID_MOBILE_RE = re.compile(r"Please input a valid mobile", re.I)
PhoneFinish = Literal["kyc", "next", "pick"]


def _normalize_msisdn(text: str) -> str:
    return re.sub(r"\D", "", text or "")


class PhoneSelectionPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def is_secondary_phone_step(self) -> bool:
        return "secondarysim" in (self.page.url or "").lower()

    def on_phone_step(self) -> bool:
        url = (self.page.url or "").lower()
        if "select-phone" in url:
            return True
        if KYC_STEP_RE.search(self.page.locator("body").inner_text()):
            return False
        if self.page.locator("#hkMobile").count() > 0:
            try:
                return self.page.locator("#hkMobile").first.is_visible()
            except Exception:
                pass
        return bool(PHONE_STEP_RE.search(self.page.locator("body").inner_text()))

    def _phone_cards(self):
        return self.page.locator(".phone-grid .phone-card, .phone-card")

    def _activate_new_number_tab(self) -> None:
        for loc in (
            self.page.get_by_role("button", name=re.compile(r"^New Number$", re.I)),
            self.page.get_by_role("tab", name=re.compile(r"^New Number$", re.I)),
        ):
            if loc.count() > 0 and loc.first.is_visible():
                loc.first.click()
                self.page.wait_for_timeout(400)
                return

    def _channel_number_region(self, line_index: int = 0) -> Locator | None:
        scope = self.page.locator(".flex-body")
        if line_index > 0:
            secondary = scope.filter(has_text=SECONDARY_SIM_PHONE_RE)
            if secondary.count() > 0:
                scope = secondary.first
        label = scope.get_by_text(CHANNEL_NUMBER_LABEL_RE)
        if label.count() == 0:
            label = self.page.get_by_text(CHANNEL_NUMBER_LABEL_RE)
        if label.count() == 0:
            return None
        for i in range(label.count()):
            anchor = label.nth(i)
            try:
                if not anchor.is_visible():
                    continue
            except Exception:
                continue
            for xpath in (
                "xpath=ancestor::*[contains(@class,'flex-body')][1]",
                "xpath=ancestor::section[1]",
                "xpath=ancestor::p-accordiontab[1]",
                "xpath=ancestor::div[contains(@class,'card')][1]",
                "xpath=ancestor::div[3]",
            ):
                region = anchor.locator(xpath)
                if region.count() > 0:
                    return region.first
        return self.page.locator(".flex-body").first

    def _looks_like_msisdn_entry(self, loc: Locator) -> bool:
        try:
            if not loc.is_visible():
                return False
            text = (loc.inner_text(timeout=500) or "").strip()
            if CHANNEL_NUMBER_LABEL_RE.search(text):
                return False
            digits = _normalize_msisdn(text)
            return len(digits) == 8
        except Exception:
            return False

    def _channel_number_entries(self, line_index: int = 0) -> Locator:
        region = self._channel_number_region(line_index)
        base = region if region is not None else self.page.locator(".flex-body")
        msisdn_re = re.compile(r"\d{4}\s*\d{4}|\d{8}")
        return base.locator(
            "button, a, [role='button'], li, .phone-card, div, span"
        ).filter(has_text=msisdn_re)

    def _wait_channel_number_entries(
        self, timeout_ms: int = 15_000, *, line_index: int = 0
    ) -> bool:
        try:
            entries = self._channel_number_entries(line_index)
            expect(entries.first).to_be_visible(timeout=timeout_ms)
            return entries.count() > 0
        except AssertionError:
            return False

    def _hk_mobile_value(self) -> str:
        field = self._hk_mobile_input()
        if field.count() == 0:
            return ""
        try:
            return _normalize_msisdn(field.first.input_value())
        except Exception:
            return ""

    def _select_channel_number_for_line(self, line_index: int) -> bool:
        prior_msisdn = self._hk_mobile_value() if line_index > 0 else ""
        if not self._wait_channel_number_entries(timeout_ms=15_000, line_index=line_index):
            return False
        entries = self._channel_number_entries(line_index)
        if entries.count() == 0:
            return False
        msisdn_seen = 0
        for i in range(min(entries.count(), 24)):
            item = entries.nth(i)
            if not self._looks_like_msisdn_entry(item):
                continue
            item.scroll_into_view_if_needed()
            item.click(force=True)
            self.page.wait_for_timeout(400)
            digits = self._hk_mobile_value()
            if len(digits) != 8:
                continue
            if line_index == 0:
                return True
            if digits != prior_msisdn:
                return True
            msisdn_seen += 1
            if msisdn_seen >= line_index:
                return True
        digits = self._hk_mobile_value()
        if len(digits) == 8 and (line_index == 0 or digits != prior_msisdn):
            return True
        return False

    def _wait_shop_mobile_cards(self, timeout_ms: int = 20_000) -> bool:
        """Portal init 会 loadShopMobileList（SHOP_MNMS_BATCH_CONFIG / B001）。"""
        try:
            expect(self._phone_cards().first).to_be_visible(timeout=timeout_ms)
            return True
        except AssertionError:
            return False

    def _select_first_shop_phone_card(self) -> bool:
        cards = self._phone_cards()
        if cards.count() == 0:
            return False
        cards.first.click()
        self.page.wait_for_timeout(400)
        return True

    def _hk_mobile_input(self):
        return self.page.locator("#hkMobile")

    def _clear_mobile_input_if_invalid(self) -> None:
        """选号前清掉误填的 ICCID 等（须 8 位 MSISDN）。"""
        field = self._hk_mobile_input()
        if field.count() == 0:
            return
        try:
            raw = field.first.input_value() or ""
        except Exception:
            return
        digits = _normalize_msisdn(raw)
        if len(digits) == 8:
            return
        if raw.strip():
            field.first.click()
            field.first.fill("")
            field.first.press("Tab")
            self.page.wait_for_timeout(300)

    def _assert_no_invalid_mobile_error(self) -> None:
        err = self.page.get_by_text(INVALID_MOBILE_RE)
        if err.count() > 0 and err.first.is_visible():
            val = self._hk_mobile_value()
            raise AssertionError(
                "SELECT_PHONE 显示 Please input a valid mobile；"
                f"#hkMobile={val!r}（勿填 ICCID，应点 Channel Number 首项）。"
            )

    def _assert_hk_phone_mnms_ok(self, msisdn: str) -> None:
        """对齐 new-select-phone validateHkPhone：blur 后 mnmsInventoryEnquiry，仅 nbrStatus=SR 可下一步。"""
        field = self._hk_mobile_input()
        expect(field).to_be_visible(timeout=10_000)
        unavailable = self.page.locator("app-common-error").filter(
            has_text=MOBILE_UNAVAILABLE_RE
        )
        if unavailable.count() > 0:
            try:
                expect(unavailable.first).to_be_hidden(timeout=8_000)
            except AssertionError:
                pass

        if unavailable.count() > 0 and unavailable.first.is_visible():
            raise AssertionError(
                f"MNMS 拒绝号码 {msisdn}（The mobile is unavailable）。"
                "Portal 仅允许 nbrStatus=SR。"
                "请换 Channel Number 列表其它项，或设 SALES_PORTAL_TEST_MSISDN fallback。"
            )

    def _fill_and_validate_hk_mobile(self, msisdn: str) -> None:
        digits = re.sub(r"\D", "", msisdn)
        if len(digits) != 8:
            raise AssertionError(f"Sim Only 测试号码须 8 位，当前: {msisdn!r}")

        field = self._hk_mobile_input()
        expect(field).to_be_visible(timeout=15_000)
        field.click()
        field.fill(digits)
        try:
            with self.page.expect_response(
                lambda r: "mnms" in r.url.lower()
                and r.request.method == "POST"
                and r.status == 200,
                timeout=30_000,
            ):
                field.blur()
        except Exception:
            field.press("Tab")
            self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(800)
        self._assert_hk_phone_mnms_ok(digits)

    def _advance_past_activation_date_if_present(self) -> None:
        ActivationDatePage(self.page).advance_past_activation_date(pick_first_cell=False)

    def _advance_one_phone_step(self) -> None:
        """Multi-SIM 单 line：选号后只点 ``>`` 进入下一 line（Secondary SIM），不进 KYC。"""
        if click_cart_footer_next_chevron(self.page):
            return
        OrderApplicationPage(self.page).next_step()

    def _advance_to_kyc(self) -> None:
        """选号后 ``>``；若进入 Activation Date 再 ``>`` 进 KYC。"""
        if click_cart_footer_next_chevron(self.page):
            self._advance_past_activation_date_if_present()
            return
        OrderApplicationPage(self.page).next_step()
        self._advance_past_activation_date_if_present()

    def _finish_phone_selection(self, finish: PhoneFinish) -> None:
        if finish == "pick":
            return
        if finish == "next":
            self._advance_one_phone_step()
            return
        self._advance_to_kyc()

    def _focus_phone_line(self, line_index: int) -> None:
        """Multi-SIM：Secondary SIM 等 line 选号前先聚焦对应区块。"""
        if line_index <= 0:
            return
        hit = self.page.get_by_text(SECONDARY_SIM_PHONE_RE)
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

    def advance_to_kyc_from_phone_step(self) -> None:
        """各 line 已选号后，从 SELECT_PHONE 进入 KYC。"""
        if not self.on_phone_step():
            return
        self._advance_to_kyc()

    def select_secondary_sim_phone_from_pool(self, *, finish: PhoneFinish = "kyc") -> None:
        """family-plan/select-phone?subModule=secondarySim：Channel 首项 + ``>``（禁止手填 ICCID）。"""
        if not self.on_phone_step():
            return
        dismiss_shop_cart_drawer(self.page)
        self._activate_new_number_tab()
        self._clear_mobile_input_if_invalid()
        if not self._select_channel_number_for_line(0):
            snippet = (self.page.locator("body").inner_text() or "")[:350].replace("\n", " ")
            raise AssertionError(
                "Secondary SIM 选号页未能点选 Channel Number 首项。"
                f" url={self.page.url!r} body≈{snippet!r}"
            )
        digits = self._hk_mobile_value()
        if len(digits) != 8:
            raise AssertionError(
                f"Secondary SIM #hkMobile 须 8 位号码，当前={digits!r} url={self.page.url!r}"
            )
        self._assert_hk_phone_mnms_ok(digits)
        self._assert_no_invalid_mobile_error()
        self._finish_phone_selection(finish)

    def advance_multi_sim_phone_steps(self) -> None:
        """Multi-SIM：Primary 选号 + ``>`` → secondarySim（若有）选 Channel 首项 + 进 KYC/Activation。"""
        if self.is_secondary_phone_step():
            self.select_secondary_sim_phone_from_pool(finish="kyc")
            return
        if self.on_phone_step():
            self.select_new_number_from_pool(finish="next", line_index=0)
            self.page.wait_for_load_state("networkidle")
        for _ in range(8):
            if self.is_secondary_phone_step():
                self.select_secondary_sim_phone_from_pool(finish="kyc")
                return
            url = (self.page.url or "").lower()
            if "select-phone" in url and "primary" in url:
                self._advance_one_phone_step()
                self.page.wait_for_load_state("networkidle")
                continue
            break
        if self.is_secondary_phone_step():
            self.select_secondary_sim_phone_from_pool(finish="kyc")
            return
        if self.on_phone_step():
            self.advance_to_kyc_from_phone_step()
            return
        if "select-date" in (self.page.url or "").lower():
            self._advance_past_activation_date_if_present()

    def select_new_number_from_pool(
        self,
        *,
        finish: PhoneFinish = "kyc",
        line_index: int = 0,
    ) -> None:
        """New Number：Channel Number 列表首项 → Shop .phone-card → env 手输 → ``>``。

        finish="kyc"：Sim Only 单线，选号后进 KYC。
        finish="next"：选池首项 + ``>`` 一步（少用）。
        finish="pick"：仅选 Channel/Shop 首项，不点 ``>``（Multi 同页 Primary 后 Secondary）。
        """
        if not self.on_phone_step():
            return
        if self.is_secondary_phone_step():
            self.select_secondary_sim_phone_from_pool(finish=finish)
            return
        dismiss_shop_cart_drawer(self.page)
        self._activate_new_number_tab()
        self._clear_mobile_input_if_invalid()
        self._focus_phone_line(line_index)

        if self._select_channel_number_for_line(line_index):
            digits = self._hk_mobile_value()
            self._assert_hk_phone_mnms_ok(digits)
            self._assert_no_invalid_mobile_error()
            self._finish_phone_selection(finish)
            return

        if self._wait_shop_mobile_cards(timeout_ms=12_000) and self._select_first_shop_phone_card():
            self._finish_phone_selection(finish)
            return

        if CHANNEL_NUMBER_LABEL_RE.search(self.page.locator("body").inner_text() or ""):
            snippet = (self.page.locator("body").inner_text() or "")[:300].replace("\n", " ")
            raise AssertionError(
                "SELECT_PHONE 有 Channel Number 但未能点选列表首项填入 #hkMobile。"
                f" line_index={line_index} finish={finish!r} 摘要: {snippet!r}"
            )

        if finish in ("next", "pick"):
            raise AssertionError(
                "Multi-SIM 选号步需要 Channel Number 池首项；"
                f"line_index={line_index} finish={finish!r} 未找到可点号码。"
            )

        msisdn = get_sim_only_test_msisdn()
        self._fill_and_validate_hk_mobile(msisdn)
        self._finish_phone_selection(finish)
