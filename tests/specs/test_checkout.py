from playwright.sync_api import Page, expect

from data.checkout_factory import empty_checkout_info, random_checkout_info
from data.product_factory import BACKPACK
from pages.cart_page import CartPage
from pages.checkout_complete_page import CheckoutCompletePage
from pages.checkout_info_page import CheckoutInfoPage
from pages.checkout_overview_page import CheckoutOverviewPage
from pages.inventory_page import InventoryPage


class TestCheckout:
    def _add_backpack_and_open_cart(self, page: Page) -> tuple[InventoryPage, CartPage]:
        inventory = InventoryPage(page)
        inventory.add_to_cart(BACKPACK)
        inventory.open_cart()
        cart = CartPage(page)
        cart.assert_loaded()
        return inventory, cart

    def test_tc011_cart_shows_added_item(self, logged_in_page: Page) -> None:
        _, cart = self._add_backpack_and_open_cart(logged_in_page)

        assert BACKPACK.name in cart.item_names()
        assert cart.item_count() == 1

    def test_tc012_remove_item_from_cart(self, logged_in_page: Page) -> None:
        inventory, cart = self._add_backpack_and_open_cart(logged_in_page)
        cart.remove_item(BACKPACK)
        cart.assert_empty()

        logged_in_page.goto("/inventory.html")
        inventory.assert_loaded()
        assert inventory.cart_badge_count() is None

    def test_tc013_complete_checkout_flow(self, logged_in_page: Page) -> None:
        _, cart = self._add_backpack_and_open_cart(logged_in_page)
        cart.checkout()

        info = CheckoutInfoPage(logged_in_page)
        info.assert_loaded()
        checkout_data = random_checkout_info()
        info.fill_info(checkout_data)
        info.continue_checkout()

        overview = CheckoutOverviewPage(logged_in_page)
        overview.assert_loaded()
        overview.finish()

        complete = CheckoutCompletePage(logged_in_page)
        complete.assert_loaded()
        assert "Thank you for your order!" in complete.complete_header()

    def test_tc014_checkout_empty_info_validation(self, logged_in_page: Page) -> None:
        _, cart = self._add_backpack_and_open_cart(logged_in_page)
        cart.checkout()

        info = CheckoutInfoPage(logged_in_page)
        info.assert_loaded()
        info.fill_info(empty_checkout_info())
        info.continue_checkout()

        errors = info.error_messages()
        assert any("First Name is required" in msg for msg in errors)
        info.assert_loaded()
