"""申请/结算向导主容器 Page Object。"""
import re

from playwright.sync_api import Page, expect

from data.account_factory import get_second_agent_name
from pages.overlay_helpers import dismiss_shop_cart_drawer

SECOND_AGENT_LABEL_RE = re.compile(r"^Second Agent$", re.I)
SECOND_AGENT_REQUIRED_RE = re.compile(
    r"Second Agent is required for Direct Sales", re.I
)


class OrderApplicationPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def next_step(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        chev = self.page.locator(".flex-body .pi.pi-chevron-right:visible").first
        if chev.count() == 0:
            chev = self.page.locator(".pi.pi-chevron-right:visible").first
        expect(chev).to_be_visible(timeout=15_000)
        chev.scroll_into_view_if_needed()
        chev.click()
        self.page.wait_for_load_state("networkidle")

    def expand_field(self, index: int = 2) -> None:
        dismiss_shop_cart_drawer(self.page)
        for _ in range(3):
            icon = self.page.locator("i").nth(index)
            if icon.count() == 0:
                self.page.wait_for_timeout(400)
                continue
            try:
                expect(icon).to_be_visible(timeout=10_000)
                icon.click(force=True)
                return
            except Exception:
                self.page.wait_for_timeout(400)
        icon = self.page.locator("i").nth(index)
        expect(icon).to_be_visible(timeout=15_000)
        icon.click(force=True)

    def _expand_second_agent_section(self) -> None:
        tab = self.page.get_by_role("button", name=SECOND_AGENT_LABEL_RE)
        for i in range(tab.count()):
            candidate = tab.nth(i)
            try:
                if not candidate.is_visible():
                    continue
                if candidate.get_attribute("aria-expanded") == "false":
                    candidate.click()
                    self.page.wait_for_timeout(400)
                return
            except Exception:
                continue

    def fill_second_agent_if_required(self, name: str | None = None) -> None:
        """Direct Sales 部门（如 CRM-PAULHP-SDIR）申请单必填 Second Agent。"""
        dismiss_shop_cart_drawer(self.page)
        self._expand_second_agent_section()
        value = (name or get_second_agent_name()).strip()
        field = self.page.get_by_label(SECOND_AGENT_LABEL_RE)
        if field.count() == 0:
            field = self.page.locator(
                'input[formcontrolname="secondAgent"], input[formControlName="secondAgent"]'
            )
        if field.count() == 0:
            if self.page.get_by_text(SECOND_AGENT_REQUIRED_RE).count() == 0:
                return
            raise AssertionError(
                "页面提示 Second Agent 必填，但未找到输入框；请检查 Portal agent 手风琴是否展开。"
            )
        input_el = field.first
        try:
            if not input_el.is_visible():
                self._expand_second_agent_section()
        except Exception:
            pass
        try:
            if input_el.input_value().strip():
                return
        except Exception:
            pass
        expect(input_el).to_be_visible(timeout=15_000)
        input_el.fill(value)
        input_el.blur()
        self.page.wait_for_timeout(300)
