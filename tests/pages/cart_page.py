import re

from playwright.sync_api import Page, expect

from data.product_factory import Product


class CartPage:
    URL = "/cart.html"

    def __init__(self, page: Page) -> None:
        self.page = page

    def assert_loaded(self) -> None:
        expect(self.page).to_have_url(re.compile(r".*cart\.html"))

    def item_names(self) -> list[str]:
        return self.page.locator(".inventory_item_name").all_inner_texts()

    def item_count(self) -> int:
        return self.page.locator(".cart_item").count()

    def remove_item(self, product: Product) -> None:
        self.page.get_by_test_id(f"remove-{product.slug}").click()

    def checkout(self) -> None:
        self.page.get_by_test_id("checkout").click()

    def assert_empty(self) -> None:
        expect(self.page.locator(".cart_item")).to_have_count(0)
