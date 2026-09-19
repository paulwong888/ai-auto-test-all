import re

from playwright.sync_api import Page, expect

from data.user_factory import (
    empty_username_user,
    invalid_user,
    locked_user,
    valid_user,
    wrong_password_user,
)
from pages.inventory_page import InventoryPage
from pages.login_page import LoginPage


class TestLogin:
    def test_tc001_login_success(self, page: Page) -> None:
        login = LoginPage(page)
        login.goto()
        username, password = valid_user()
        login.login(username, password)

        inventory = InventoryPage(page)
        inventory.assert_loaded()

    def test_tc002_login_invalid_username(self, page: Page) -> None:
        login = LoginPage(page)
        login.goto()
        username, password = invalid_user()
        login.login(username, password)

        expect(login.error_message()).to_be_visible()
        expect(login.error_message()).to_contain_text("do not match")
        login.assert_on_login_page()

    def test_tc003_login_wrong_password(self, page: Page) -> None:
        login = LoginPage(page)
        login.goto()
        username, password = wrong_password_user()
        login.login(username, password)

        expect(login.error_message()).to_be_visible()
        expect(login.error_message()).to_contain_text("do not match")
        login.assert_on_login_page()

    def test_tc004_login_locked_user(self, page: Page) -> None:
        login = LoginPage(page)
        login.goto()
        username, password = locked_user()
        login.login(username, password)

        expect(login.error_message()).to_be_visible()
        expect(login.error_message()).to_contain_text("locked out", ignore_case=True)
        login.assert_on_login_page()

    def test_tc005_login_empty_username(self, page: Page) -> None:
        login = LoginPage(page)
        login.goto()
        username, password = empty_username_user()
        login.login(username, password)

        expect(login.error_message()).to_be_visible()
        expect(login.error_message()).to_contain_text("Username is required")
        expect(page).to_have_url(re.compile(r".saucedemo.com/?$|.*index\.html"))
