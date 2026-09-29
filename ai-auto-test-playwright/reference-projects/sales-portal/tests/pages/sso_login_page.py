"""RHSSO Keycloak OIDC 登录页 Page Object。"""
from playwright.sync_api import Page, expect

from data.account_factory import get_password, get_username


class SsoLoginPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.username = page.get_by_role("textbox", name="Username or email")
        self.password = page.get_by_role("textbox", name="Password")
        self.sign_in_button = page.get_by_role("button", name="Sign In")

    def login(self, username: str | None = None, password: str | None = None) -> None:
        """输入账号密码并点击 Sign In。"""
        self.username.fill(username or get_username())
        self.password.fill(password or get_password())
        self.sign_in_button.click()

    def expect_error_visible(self) -> None:
        """SSO 登录失败：仍在登录页且出现错误提示区域。"""
        expect(self.sign_in_button).to_be_visible()
        # Keycloak 内联错误，常见为 role="alert" 或 #input-error 类区域
        alert = self.page.get_by_role("alert")
        if alert.count() > 0:
            expect(alert.first).to_be_visible()
        else:
            expect(self.page.locator("#input-error, .alert-error, .kc-feedback-text").first).to_be_visible()

    def expect_logged_out(self) -> None:
        """断言仍停留在 SSO 登录页（未进入门户）。"""
        expect(self.sign_in_button).to_be_visible()
        expect(self.username).to_be_visible()
