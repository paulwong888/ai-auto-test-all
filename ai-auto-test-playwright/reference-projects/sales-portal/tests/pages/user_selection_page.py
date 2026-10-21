"""SSO 登录后的 Choose user account（多 POS 用户）。"""
import re

from playwright.sync_api import Locator, Page, expect

from data.account_factory import POS_ACCOUNT_CASHIER, get_pos_account

E2E_POS_STORAGE_KEY = "sales_portal_e2e_pos"


def get_marked_pos_account(page: Page) -> str | None:
    try:
        value = page.evaluate(
            f"(key) => sessionStorage.getItem(key)",
            E2E_POS_STORAGE_KEY,
        )
        if isinstance(value, str) and value.strip():
            return value.strip()
    except Exception:
        pass
    return None


def mark_pos_account_selected(page: Page, pos: str) -> None:
    pos = pos.strip()
    if not pos:
        return
    try:
        page.evaluate(
            "([key, val]) => sessionStorage.setItem(key, val)",
            [E2E_POS_STORAGE_KEY, pos],
        )
    except Exception:
        pass


def clear_marked_pos_account(page: Page) -> None:
    try:
        page.evaluate(
            "(key) => sessionStorage.removeItem(key)",
            E2E_POS_STORAGE_KEY,
        )
    except Exception:
        pass


def logout_portal_if_home(page: Page) -> None:
    """已进门户顶栏时从菜单登出，以便重新 Choose user account。"""
    if get_marked_pos_account(page) is not None:
        clear_marked_pos_account(page)
    try:
        expect(page.locator("app-new-header")).to_be_visible(timeout=5_000)
    except AssertionError:
        return
    menu = page.locator("button.pi-bars.header-menu-icon, button.pi-bars").first
    if menu.count() == 0:
        return
    menu.click()
    page.wait_for_timeout(400)
    for label in ("Logout", "登出"):
        item = page.get_by_text(label, exact=True)
        if item.count() > 0 and item.first.is_visible():
            item.first.click()
            page.wait_for_load_state("networkidle")
            break
    page.wait_for_timeout(600)


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

    def _locate_pos_button(self, pos: str) -> Locator:
        """Choose user account 上的子账号按钮（accountDetail.account）。"""
        pos = pos.strip()
        wrapper = self.page.locator("#user-selection, crm-user-selection .btnWrapper")
        candidates: list[Locator] = [
            wrapper.get_by_role("button", name=pos),
            wrapper.get_by_role("button").filter(
                has_text=re.compile(rf"^\s*{re.escape(pos)}\s*$", re.I)
            ),
            self.page.locator("#user-selection, crm-user-selection").get_by_role(
                "button"
            ).filter(has_text=re.compile(re.escape(pos), re.I)),
            self.page.get_by_role("button", name=pos),
            self.page.get_by_role("button").filter(
                has_text=re.compile(re.escape(pos), re.I)
            ),
        ]
        for loc in candidates:
            if loc.count() > 0:
                return loc.first
        return self.page.get_by_role("button", name=pos).first

    def select_pos_account(self, account: str | None = None) -> None:
        """点击 POS 子账号（如 CRM-AUTOTEST-FORTRESS）。"""
        pos = (account or get_pos_account()).strip()
        button = self._locate_pos_button(pos)
        expect(button).to_be_visible(timeout=60_000)
        button.click()
        expect(self.page.locator("app-new-header")).to_be_visible(timeout=120_000)
        mark_pos_account_selected(self.page, pos)

    def _header_indicates_pos(self, pos: str) -> bool:
        header = self.page.locator("app-new-header")
        if header.filter(has_text=pos).count() > 0:
            try:
                return header.filter(has_text=pos).first.is_visible()
            except Exception:
                return True
        return False

    def _logout_and_select_pos(self, pos: str) -> None:
        from conftest import BASE_URL
        from pages.sso_login_page import SsoLoginPage

        if get_marked_pos_account(self.page) == pos:
            return

        logout_portal_if_home(self.page)
        self.page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)

        if not self.is_choose_account_visible(timeout_ms=8_000):
            try:
                expect(
                    self.page.get_by_role("textbox", name="Username or email")
                ).to_be_visible(timeout=8_000)
                SsoLoginPage(self.page).login()
            except AssertionError:
                pass

        if not self.is_choose_account_visible(timeout_ms=20_000):
            raise RuntimeError(
                f"无法切换到 POS 子账号「{pos}」：未出现 Choose user account。"
                " Fortress / Direct Sale 依赖 CRM-AUTOTEST-FORTRESS / CRM-AUTOTEST-SDIR。"
            )
        self.select_pos_account(pos)

    def ensure_pos_account(self, account: str | None = None) -> None:
        """确保已选目标 POS 子账号（SSO 直进门户时不会自动选对）。"""
        from pages.home_page import HomePage

        pos = (account or get_pos_account()).strip()
        needs_sub_account = pos != POS_ACCOUNT_CASHIER

        if get_marked_pos_account(self.page) == pos:
            HomePage(self.page).expect_header_visible()
            return

        if self.is_choose_account_visible(timeout_ms=3_000):
            self.select_pos_account(pos)
            return

        if needs_sub_account:
            if self._header_indicates_pos(pos):
                mark_pos_account_selected(self.page, pos)
                HomePage(self.page).expect_header_visible()
                return
            self._logout_and_select_pos(pos)
            return

        if self._header_indicates_pos(pos):
            mark_pos_account_selected(self.page, pos)
            HomePage(self.page).expect_header_visible()
            return
        HomePage(self.page).expect_header_visible()
