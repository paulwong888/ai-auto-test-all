"""PAYMENT 步（app-new-payment）— 选择支付方式（Cashier / Online Payment）。"""
import re

from playwright.sync_api import Page, expect

from pages.overlay_helpers import dismiss_shop_cart_drawer

PAYMENT_STEP_RE = re.compile(r"Payment Method|Primary Sim Mobile Number", re.I)
ONLINE_PAYMENT_RE = re.compile(r"Online Payment|在线支付", re.I)
CASHIER_RE = re.compile(r"Cashier|cashier|收银", re.I)


class PaymentMethodPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def expect_on_step(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        body = self.page.locator(".flex-body")
        expect(body.get_by_text(PAYMENT_STEP_RE).first).to_be_visible(timeout=60_000)

    def _pick_radio(self, input_id: str, label_fallback: re.Pattern[str]) -> None:
        dismiss_shop_cart_drawer(self.page)
        self.expect_on_step()

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
