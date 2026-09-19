import re

from playwright.sync_api import Page, expect


class CheckoutCompletePage:
    URL = "/checkout-complete.html"

    def __init__(self, page: Page) -> None:
        self.page = page

    def assert_loaded(self) -> None:
        expect(self.page).to_have_url(re.compile(r".*checkout-complete\.html"))

    def complete_header(self) -> str:
        return self.page.locator(".complete-header").inner_text()
