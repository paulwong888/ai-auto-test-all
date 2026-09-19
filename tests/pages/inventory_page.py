import re

from playwright.sync_api import Page, expect

from data.product_factory import Product


class InventoryPage:
    URL = "/inventory.html"

    def __init__(self, page: Page) -> None:
        self.page = page

    def assert_loaded(self) -> None:
        expect(self.page).to_have_url(re.compile(r".*inventory\.html"))
        expect(self.page.locator(".inventory_list")).to_be_visible()

    def add_to_cart(self, product: Product) -> None:
        self.page.get_by_test_id(f"add-to-cart-{product.slug}").click()

    def remove_from_cart(self, product: Product) -> None:
        self.page.get_by_test_id(f"remove-{product.slug}").click()

    def open_product_detail(self, product: Product) -> None:
        self.page.get_by_test_id(product.item_link_test_id).click()

    def sort_by(self, label: str) -> None:
        self.page.locator(".product_sort_container").select_option(label=label)

    def first_product_name(self) -> str:
        return self.page.locator(".inventory_item_name").first.inner_text()

    def cart_badge_count(self) -> int | None:
        badge = self.page.locator(".shopping_cart_badge")
        if badge.count() == 0:
            return None
        return int(badge.inner_text())

    def open_cart(self) -> None:
        self.page.locator(".shopping_cart_link").click()

    def open_menu(self) -> None:
        self.page.get_by_role("button", name="Open Menu").click()

    def logout(self) -> None:
        self.open_menu()
        self.page.get_by_test_id("logout-sidebar-link").click()
