"""SSO 登录后的 Choose user account（多 POS 用户）。"""
from playwright.sync_api import Page, expect

from data.account_factory import get_pos_account


class UserSelectionPage:
    CHOOSE_HEADING = "Choose user account"

    def __init__(self, page: Page) -> None:
        self.page = page

    def is_choose_account_visible(self, *, timeout_ms: int = 3_000) -> bool:
        try:
            expect(self.page.get_by_role("heading", name=self.CHOOSE_HEADING)).to_be_visible(
                timeout=timeout_ms
            )
            return True
        except AssertionError:
            return False

    def select_pos_account(self, account: str | None = None) -> None:
        """点击 POS 账户按钮（accountDetail.account，如 CRM-PAULHP-01）。"""
        pos = (account or get_pos_account()).strip()
        wrapper = self.page.locator("#user-selection, crm-user-selection .btnWrapper")
        button = wrapper.get_by_role("button", name=pos)
        if button.count() == 0:
            button = self.page.get_by_role("button", name=pos)
        expect(button.first).to_be_visible(timeout=60_000)
        button.first.click()
        expect(self.page.locator("app-new-header")).to_be_visible(timeout=120_000)
