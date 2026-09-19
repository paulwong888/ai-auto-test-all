from playwright.sync_api import Page

from pages.inventory_page import InventoryPage
from pages.login_page import LoginPage


class TestSession:
    def test_tc015_logout(self, logged_in_page: Page) -> None:
        inventory = InventoryPage(logged_in_page)
        inventory.logout()

        login = LoginPage(logged_in_page)
        login.assert_on_login_page()
