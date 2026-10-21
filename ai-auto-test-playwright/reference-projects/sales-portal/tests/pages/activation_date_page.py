"""Select Activation Date 步 — Sim Only 直接 chevron；Fortress 可选点日历格。"""
import re

from playwright.sync_api import Page

from pages.order_application_page import OrderApplicationPage
from pages.overlay_helpers import click_cart_footer_next_chevron, dismiss_shop_cart_drawer

ACTIVATION_DATE_STEP_RE = re.compile(
    r"Select Activation Date|Activation Date", re.I
)
KYC_STEP_RE = re.compile(r"Test ID|Credit Check|HKID|香港身份", re.I)


class ActivationDatePage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def _body_text(self) -> str:
        return self.page.locator("body").inner_text()

    def is_activation_step(self) -> bool:
        url = (self.page.url or "").lower()
        if "select-date" in url:
            return True
        body = self._body_text()
        if KYC_STEP_RE.search(body):
            return False
        return bool(ACTIVATION_DATE_STEP_RE.search(body))

    def _pick_first_available_calendar_cell(self) -> None:
        grid = self.page.get_by_role("grid")
        if grid.count() == 0:
            return
        cells = grid.first.get_by_role("gridcell")
        for i in range(cells.count()):
            cell = cells.nth(i)
            try:
                if not cell.is_visible():
                    continue
                if cell.get_attribute("aria-disabled") == "true":
                    continue
                label = cell.inner_text().strip()
                if not label.isdigit():
                    continue
                cell.click()
                self.page.wait_for_timeout(400)
                return
            except Exception:
                continue

    def advance_past_activation_date(self, *, pick_first_cell: bool = False) -> bool:
        """离开激活日步：Sim Only 默认仅点 ``>``；Fortress 可 ``pick_first_cell=True``。"""
        if not self.is_activation_step():
            return False
        dismiss_shop_cart_drawer(self.page)
        if pick_first_cell:
            self._pick_first_available_calendar_cell()
        if not click_cart_footer_next_chevron(self.page):
            OrderApplicationPage(self.page).next_step()
        self.page.wait_for_load_state("networkidle")
        return True
