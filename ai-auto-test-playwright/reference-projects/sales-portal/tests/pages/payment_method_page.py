"""PAYMENT 步（app-new-payment）— 选择在线支付方式。"""
import re

from playwright.sync_api import Page, expect

from pages.overlay_helpers import dismiss_shop_cart_drawer

PAYMENT_STEP_RE = re.compile(r"Payment Method|Primary Sim Mobile Number", re.I)
ONLINE_PAYMENT_RE = re.compile(r"Online Payment|在线支付", re.I)


class PaymentMethodPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def expect_on_step(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        body = self.page.locator(".flex-body")
        expect(body.get_by_text(PAYMENT_STEP_RE).first).to_be_visible(timeout=60_000)

    def pick_online_payment(self) -> None:
        """对齐 new-payment.component.html：p-radioButton inputId='OnlinePayment'。"""
        dismiss_shop_cart_drawer(self.page)
        self.expect_on_step()

        online_radio = self.page.locator('input[type="radio"]#OnlinePayment')
        if online_radio.count() > 0:
            box = online_radio.locator("xpath=ancestor::*[contains(@class,'p-radiobutton')][1]").locator(
                ".p-radiobutton-box"
            )
            if box.count() > 0:
                box.first.click(force=True)
            else:
                self.page.locator('label[for="OnlinePayment"]').first.click(force=True)
        else:
            online = self.page.locator(".p-radiobutton").filter(has_text=ONLINE_PAYMENT_RE)
            expect(online.first).to_be_visible(timeout=15_000)
            online.first.locator(".p-radiobutton-box").click(force=True)

        checked = self.page.locator('input[type="radio"]#OnlinePayment')
        if checked.count() > 0:
            expect(checked.first).to_be_checked(timeout=10_000)
