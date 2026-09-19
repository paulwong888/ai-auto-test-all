from playwright.sync_api import Page, expect

from data.product_factory import BACKPACK, ONESIE
from pages.inventory_page import InventoryPage
from pages.product_detail_page import ProductDetailPage


class TestInventory:
    def test_tc006_add_backpack_to_cart(self, logged_in_page: Page) -> None:
        inventory = InventoryPage(logged_in_page)
        inventory.add_to_cart(BACKPACK)

        expect(logged_in_page.get_by_test_id(f"remove-{BACKPACK.slug}")).to_be_visible()
        assert inventory.cart_badge_count() == 1

    def test_tc007_view_product_detail(self, logged_in_page: Page) -> None:
        inventory = InventoryPage(logged_in_page)
        inventory.open_product_detail(BACKPACK)

        detail = ProductDetailPage(logged_in_page)
        detail.assert_loaded()
        assert detail.product_name() == BACKPACK.name

    def test_tc008_back_to_products_from_detail(self, logged_in_page: Page) -> None:
        inventory = InventoryPage(logged_in_page)
        inventory.open_product_detail(BACKPACK)

        detail = ProductDetailPage(logged_in_page)
        detail.back_to_products()

        inventory.assert_loaded()
        expect(logged_in_page.locator(".inventory_list")).to_be_visible()

    def test_tc009_sort_by_name_asc(self, logged_in_page: Page) -> None:
        inventory = InventoryPage(logged_in_page)
        inventory.sort_by("Name (A to Z)")

        assert inventory.first_product_name() == BACKPACK.name

    def test_tc010_sort_by_price_low_to_high(self, logged_in_page: Page) -> None:
        inventory = InventoryPage(logged_in_page)
        inventory.sort_by("Price (low to high)")

        assert inventory.first_product_name() == ONESIE.name
