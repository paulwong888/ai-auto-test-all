import re

from playwright.sync_api import Page, expect


class CheckoutOverviewPage:
    URL = "/checkout-step-two.html"

    def __init__(self, page: Page) -> None:
        self.page = page

    def assert_loaded(self) -> None:
        expect(self.page).to_have_url(re.compile(r".*checkout-step-two\.html"))

    def finish(self) -> None:
        self.page.get_by_test_id("finish").click()
