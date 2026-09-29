"""SIM / 服务信息阶段（录制 chevron 后 SIM 步）。"""
import re

from playwright.sync_api import Page, expect

from data.sim_factory import get_imsi, get_sim_iccid
from pages.overlay_helpers import dismiss_shop_cart_drawer

TERMS_PATTERN = re.compile(r"I have read and agree", re.I)


class SimServicePage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def fill_sim_ids(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        expect(self.page.get_by_text(re.compile(r"Primary Sim", re.I)).first).to_be_visible(
            timeout=30_000
        )
        iccid = self.page.get_by_role("textbox").first
        imsi = self.page.get_by_role("textbox").nth(1)
        expect(iccid).to_be_visible(timeout=15_000)
        iccid.fill(get_sim_iccid())
        imsi.fill(get_imsi())

    def agree_terms(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        icon = self.page.locator("i").nth(5)
        if icon.count() > 0 and icon.is_visible():
            icon.click()
        cb = self.page.get_by_role("checkbox").filter(has_text=TERMS_PATTERN)
        if cb.count() > 0:
            cb.first.check(force=True)
            return
        fallback = self.page.get_by_role("checkbox").filter(
            has_text=re.compile(r"agree|read|terms", re.I)
        )
        if fallback.count() > 0:
            fallback.first.check(force=True)
            return
        visible = self.page.locator(".flex-body").get_by_role("checkbox").first
        if visible.count() > 0:
            visible.check(force=True)

    def sign_consent(self) -> None:
        canvas = self.page.locator("canvas:visible").last
        if canvas.count() == 0:
            return
        box = canvas.bounding_box()
        if box:
            canvas.click(position={"x": box["width"] * 0.5, "y": box["height"] * 0.4}, force=True)
        else:
            canvas.click(force=True)

    def pick_agreement_type(self, index: int = 3) -> None:
        dismiss_shop_cart_drawer(self.page)
        icon = self.page.locator("i").nth(2)
        if icon.count() > 0 and icon.is_visible():
            icon.click()
        radio = self.page.locator(
            "div:nth-child(2) > .p-element.ng-untouched > .p-radiobutton > .p-radiobutton-box"
        )
        if radio.count() > 0:
            radio.first.click()
            if icon.count() > 0:
                icon.click()
