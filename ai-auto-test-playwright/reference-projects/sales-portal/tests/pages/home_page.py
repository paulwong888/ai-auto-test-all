"""登录后销售门户首页 Page Object。"""
import re

from playwright.sync_api import Page, expect


class HomePage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.app_header = page.locator("app-new-header")
        self.header_menu_button = self.app_header.get_by_role("button").filter(
            has_text=re.compile(r"^$")
        )
        self.sidebar = page.get_by_role("complementary")

    def expect_header_visible(self) -> None:
        expect(self.app_header).to_be_visible()

    def open_header_menu(self) -> None:
        """打开侧栏主导航（页头空文本按钮；5G HBB 在 complementary 侧栏）。"""
        if self.sidebar.get_by_text("5G HBB", exact=False).count() == 0:
            expect(self.header_menu_button.first).to_be_visible()
            self.header_menu_button.first.click()
        expect(self.sidebar.get_by_text("5G HBB", exact=False).first).to_be_visible(
            timeout=15_000
        )
