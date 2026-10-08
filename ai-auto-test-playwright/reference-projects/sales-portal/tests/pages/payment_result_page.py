"""门户侧支付结果区 — Check Payment Status / Back to index。"""
import re

from playwright.sync_api import Page, expect

from pages.overlay_helpers import dismiss_shop_cart_drawer


class PaymentResultPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def check_payment_status(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        btn = self.page.get_by_role("button", name="Check Payment Status").first
        expect(btn).to_be_visible(timeout=60_000)
        btn.click()
        overlay = self.page.locator(".cdk-overlay-pane, .p-dialog").filter(
            has_text=re.compile(r"payment|success|收款|Payment", re.I)
        )
        if overlay.count() > 0:
            expect(overlay.first).to_be_visible(timeout=30_000)
            return
        expect(self.page.locator(".cdk-overlay-backdrop:visible").first).to_be_visible(
            timeout=30_000
        )

    def close_status_overlay(self) -> None:
        backdrop = self.page.locator(".cdk-overlay-backdrop:visible")
        if backdrop.count() > 0:
            backdrop.first.click(force=True)
            self.page.wait_for_timeout(400)
            return
        self.page.keyboard.press("Escape")

    def back_to_index(self) -> None:
        btn = self.page.get_by_role("button", name="Back to index").first
        expect(btn).to_be_visible(timeout=30_000)
        btn.click()
        self.page.wait_for_load_state("networkidle")
