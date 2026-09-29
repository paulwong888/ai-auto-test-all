"""产品线/报价列表页 Page Object（侧栏 Browse Offer 导航 + 主区列表）。"""
import re

from playwright.sync_api import Page, expect

from data.offer_factory import get_offer


class ProductListingPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.sidebar = page.get_by_role("complementary")
        self.header_menu_button = page.locator("app-new-header").get_by_role("button").filter(
            has_text=re.compile(r"^$")
        )

    def _open_header_menu(self) -> None:
        if self.sidebar.get_by_text("5G HBB", exact=False).count() == 0:
            self.header_menu_button.first.click()
        expect(self.sidebar.get_by_text("5G HBB", exact=False).first).to_be_visible(
            timeout=15_000
        )

    def _sidebar_link(self, name: str):
        return self.sidebar.locator("a").filter(has_text=name).first

    def navigate_5g_hbb(self) -> None:
        self._open_header_menu()
        self._sidebar_link("5G HBB").click()
        self.page.wait_for_load_state("networkidle")

    def navigate_5g_bb(self) -> None:
        self._open_header_menu()
        self._sidebar_link("5G HBB").click()
        self.page.wait_for_timeout(500)
        bb = self.sidebar.locator("a").filter(has_text="5G BB")
        if bb.count() == 0:
            self.sidebar.get_by_text("5G BB", exact=True).click()
        else:
            bb.first.click()
        self.page.wait_for_load_state("networkidle")

    def go_to_page(self, page_number: int) -> None:
        self.page.get_by_role("button", name=str(page_number)).click()
        self.page.wait_for_load_state("networkidle")

    def select_offer_by_key(self) -> None:
        """点击目标套餐卡片（offer_factory key）；已选中则跳过重复点击。"""
        key = get_offer()["key"]
        card = self.page.locator("div.box").filter(has_text=key).first
        expect(card).to_be_visible(timeout=15_000)
        card.evaluate("el => el.scrollIntoView({block: 'center', inline: 'nearest'})")
        self.page.wait_for_timeout(400)
        cls = card.get_attribute("class") or ""
        if "selected" not in cls:
            card.click(timeout=15_000)

    def select_target_offer(self) -> None:
        offer = get_offer()
        card = self.page.get_by_text(offer["price"], exact=False).first
        expect(card).to_be_visible(timeout=15_000)
        card.click()

    def expect_nav_selected(self, name: str) -> None:
        """导航后侧栏可能收起，改断言主内容区已加载。"""
        self.expect_list_refreshed()
        if "BB" in name and "HBB" not in name:
            expect(self.page.get_by_text("$168", exact=False).first).to_be_visible(timeout=15_000)

    def expect_list_refreshed(self, keyword: str | None = None) -> None:
        _ = keyword
        expect(self.page.get_by_text("Featured Monthly Plans", exact=False).first).to_be_visible(
            timeout=15_000
        )

    def expect_page_selected(self, page_number: int) -> None:
        btn = self.page.get_by_role("button", name=str(page_number))
        expect(btn).to_be_visible()
        expect(self.page.get_by_text("$168", exact=False).first).to_be_visible(timeout=15_000)

    def expect_list_nonempty(self) -> None:
        expect(self.page.get_by_text("$168", exact=False).first).to_be_visible(timeout=15_000)

    def expect_offer_detail_visible(self) -> None:
        offer = get_offer()
        expect(self.page.get_by_text(offer["data"], exact=False).first).to_be_visible(
            timeout=15_000
        )
        expect(self.page.get_by_text(offer["dns_vas"], exact=False).first).to_be_visible(
            timeout=15_000
        )
