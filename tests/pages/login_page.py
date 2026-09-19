import re

from playwright.sync_api import Page, expect


class LoginPage:
    URL = "https://www.saucedemo.com/"

    def __init__(self, page: Page) -> None:
        self.page = page

    def goto(self) -> None:
        self.page.goto(self.URL, wait_until="networkidle")
        self.page.get_by_test_id("username").wait_for(state="visible")

    def login(self, username: str, password: str) -> None:
        self.page.get_by_test_id("username").fill(username)
        self.page.get_by_test_id("password").fill(password)
        self.page.get_by_test_id("login-button").click()

    def error_message(self):
        return self.page.locator("[data-test='error']")

    def assert_on_login_page(self) -> None:
        expect(self.page.get_by_test_id("login-button")).to_be_visible()
        expect(self.page).to_have_url(re.compile(r".saucedemo.com/?$|.*index\.html"))
