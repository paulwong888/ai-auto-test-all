"""PAYMENT 步（app-new-payment）— Cashier / Online / Direct Sale / Fortress。"""
import re

from playwright.sync_api import Page, expect

from pages.overlay_helpers import dismiss_shop_cart_drawer

PAYMENT_STEP_RE = re.compile(r"Payment Method|Primary Sim Mobile Number", re.I)
ONLINE_PAYMENT_RE = re.compile(r"Online Payment|在线支付", re.I)
CASHIER_RE = re.compile(r"Cashier|cashier|收银", re.I)
DIRECT_SALE_RE = re.compile(r"Direct Sale Payment|Direct Sales|直销", re.I)
FORTRESS_RE = re.compile(r"Fortress Payment", re.I)


class PaymentMethodPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def expect_on_step(self) -> None:
        from conftest import recover_portal_session_if_needed

        recover_portal_session_if_needed(self.page)
        dismiss_shop_cart_drawer(self.page)
        body = self.page.locator(".flex-body")
        expect(body.get_by_text(PAYMENT_STEP_RE).first).to_be_visible(timeout=60_000)

    def _assert_payment_option_available(
        self, input_id: str, label_fallback: re.Pattern[str]
    ) -> None:
        """无对应 radio 时快速失败（避免空等 15s 且 session 中途过期）。"""
        if self.page.locator(f'input[type="radio"]#{input_id}').count() > 0:
            return
        if self.page.get_by_role("radio", name=label_fallback).count() > 0:
            return
        if self.page.locator(".p-radiobutton").filter(has_text=label_fallback).count() > 0:
            return
        body = self.page.locator("body").inner_text()
        if input_id == "DirectSales" and "Direct Sale" not in body:
            raise AssertionError(
                "PAYMENT 步未出现 Direct Sale Payment。"
                " 请确认用例使用 logged_in_page_sdir，且建单前已选子账号 CRM-AUTOTEST-SDIR"
                "（默认 CRM-AUTOTEST-PREPAID001 仅有 Cashier / Online）。"
                f" 当前页摘要: {body[:280]!r}"
            )
        if input_id == "FortressPayment" and "Fortress" not in body:
            raise AssertionError(
                "PAYMENT 步未出现 Fortress Payment。"
                " 请确认 logged_in_page_fortress 且子账号 CRM-AUTOTEST-FORTRESS。"
                f" 当前页摘要: {body[:280]!r}"
            )

    def _pick_radio(self, input_id: str, label_fallback: re.Pattern[str]) -> None:
        from conftest import recover_portal_session_if_needed

        dismiss_shop_cart_drawer(self.page)
        recover_portal_session_if_needed(self.page)
        self.expect_on_step()
        recover_portal_session_if_needed(self.page)

        radio = self.page.locator(f'input[type="radio"]#{input_id}')
        if radio.count() > 0:
            box = radio.locator("xpath=ancestor::*[contains(@class,'p-radiobutton')][1]").locator(
                ".p-radiobutton-box"
            )
            if box.count() > 0:
                box.first.click(force=True)
            else:
                self.page.locator(f'label[for="{input_id}"]').first.click(force=True)
        else:
            self._assert_payment_option_available(input_id, label_fallback)
            by_role = self.page.get_by_role("radio", name=label_fallback)
            if by_role.count() > 0:
                by_role.first.click(force=True)
            else:
                option = self.page.locator(".p-radiobutton").filter(has_text=label_fallback)
                expect(option.first).to_be_visible(timeout=15_000)
                option.first.locator(".p-radiobutton-box").click(force=True)

        checked = self.page.locator(f'input[type="radio"]#{input_id}')
        if checked.count() > 0:
            expect(checked.first).to_be_checked(timeout=10_000)

    def pick_cashier(self) -> None:
        """对齐 new-payment.component：inputId='Cashier'（SalesPortalPaymentMethod.Cashier）。"""
        self._pick_radio("Cashier", CASHIER_RE)

    def pick_online_payment(self) -> None:
        """对齐 new-payment.component.html：p-radioButton inputId='OnlinePayment'。"""
        self._pick_radio("OnlinePayment", ONLINE_PAYMENT_RE)

    def pick_direct_sale_payment(self) -> None:
        """SalesPortalPaymentMethod.DirectSales → inputId='DirectSales'（paymentInfo.directSalesPayment）。"""
        self._pick_radio("DirectSales", DIRECT_SALE_RE)

    def pick_fortress_payment(self) -> None:
        """SalesPortalPaymentMethod.FortressPayment → inputId='FortressPayment'。"""
        self._pick_radio("FortressPayment", FORTRESS_RE)
