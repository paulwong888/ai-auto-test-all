from playwright.sync_api import Page, expect


class ProductDetailPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def assert_loaded(self) -> None:
        expect(self.page.locator("div.inventory_details")).to_be_visible()

    def product_name(self) -> str:
        return self.page.locator("div.inventory_details_name").inner_text()

    def back_to_products(self) -> None:
        self.page.get_by_test_id("back-to-products").click()
