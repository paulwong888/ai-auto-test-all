import re

from playwright.sync_api import Page, expect

from data.checkout_factory import CheckoutInfo


class CheckoutInfoPage:
    URL = "/checkout-step-one.html"

    def __init__(self, page: Page) -> None:
        self.page = page

    def assert_loaded(self) -> None:
        expect(self.page).to_have_url(re.compile(r".*checkout-step-one\.html"))

    def fill_info(self, info: CheckoutInfo) -> None:
        self.page.get_by_test_id("firstName").fill(info.first_name)
        self.page.get_by_test_id("lastName").fill(info.last_name)
        self.page.get_by_test_id("postalCode").fill(info.postal_code)

    def continue_checkout(self) -> None:
        self.page.get_by_test_id("continue").click()

    def error_messages(self) -> list[str]:
        return self.page.locator("[data-test='error']").all_inner_texts()
