"""申请/结算向导主容器 Page Object。"""
from playwright.sync_api import Page, expect

from pages.overlay_helpers import dismiss_shop_cart_drawer


class OrderApplicationPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def next_step(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        chev = self.page.locator(".flex-body .pi.pi-chevron-right:visible").first
        if chev.count() == 0:
            chev = self.page.locator(".pi.pi-chevron-right:visible").first
        expect(chev).to_be_visible(timeout=15_000)
        chev.scroll_into_view_if_needed()
        chev.click()
        self.page.wait_for_load_state("networkidle")

    def expand_field(self, index: int = 2) -> None:
        dismiss_shop_cart_drawer(self.page)
        icon = self.page.locator("i").nth(index)
        expect(icon).to_be_visible(timeout=15_000)
        icon.scroll_into_view_if_needed()
        icon.click()
