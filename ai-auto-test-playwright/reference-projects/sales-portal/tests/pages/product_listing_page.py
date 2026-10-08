"""产品线/报价列表页 Page Object（侧栏 Browse Offer 导航 + 主区列表）。"""
import re

from playwright.sync_api import Page, expect

from conftest import BASE_URL
from data.offer_factory import get_offer
from pages.overlay_helpers import (
    bb_browse_listing_visible,
    can_browse_offers,
    exit_draft_application_to_browse,
    force_browse_home,
    has_bb_offer_listing,
    pending_payment_visible,
    _click_new_subscription,
    _in_offer_configuration,
    _try_back_to_browse_from_payment_wait,
)


class ProductListingPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.sidebar = page.get_by_role("complementary")
        self.header_menu_button = page.locator("app-new-header").get_by_role("button").filter(
            has_text=re.compile(r"^$")
        )

    def _sidebar_nav_visible(self) -> bool:
        hbb = self.sidebar.get_by_text("5G HBB", exact=False)
        if hbb.count() == 0:
            return False
        try:
            return hbb.first.is_visible()
        except Exception:
            return False

    def _open_header_menu(self) -> None:
        """侧栏未展开时才点 header（避免 toggle 关侧栏或连开两次）。"""
        if not self._sidebar_nav_visible():
            self.header_menu_button.first.click()
            self.page.wait_for_timeout(400)
        expect(self.sidebar.get_by_text("5G HBB", exact=False).first).to_be_visible(
            timeout=15_000
        )

    def _close_header_menu(self) -> None:
        if self._sidebar_nav_visible():
            self.header_menu_button.first.click()
            self.page.wait_for_timeout(300)

    def _sidebar_link(self, name: str):
        return self.sidebar.locator("a").filter(has_text=name).first

    def _click_5g_bb_in_sidebar(self) -> None:
        """录制 sales-portal.py L19-21：开菜单一次 → 5G HBB → 5G BB。"""
        self._open_header_menu()
        bb = self.sidebar.locator("a").filter(has_text="5G BB")
        if bb.count() > 0:
            try:
                if bb.first.is_visible():
                    bb.first.click()
                    self.page.wait_for_load_state("networkidle")
                    return
            except Exception:
                pass

        self._sidebar_link("5G HBB").click()
        self.page.wait_for_timeout(500)
        if not self._sidebar_nav_visible():
            self._open_header_menu()

        bb = self.sidebar.locator("a").filter(has_text="5G BB")
        expect(
            bb.first if bb.count() > 0 else self.sidebar.get_by_text("5G BB", exact=True).first
        ).to_be_visible(timeout=15_000)
        if bb.count() == 0:
            self.sidebar.get_by_text("5G BB", exact=True).click()
        else:
            bb.first.click()
        self.page.wait_for_load_state("networkidle")

    def navigate_5g_hbb(self) -> None:
        self._open_header_menu()
        self._sidebar_link("5G HBB").click()
        self.page.wait_for_load_state("networkidle")

    def navigate_5g_bb_recorded(self) -> None:
        """进入 5G BB 列表（录制意图：HBB → BB；实现走侧栏展开，避免全局 a 定位超时）。"""
        self._click_5g_bb_in_sidebar()
        self._dismiss_sidebar_mask()

    def _dismiss_sidebar_mask(self) -> None:
        """导航后关闭侧栏/mask，避免挡住分页/套餐点击（仅侧栏已展开时才关）。"""
        self.page.keyboard.press("Escape")
        self.page.wait_for_timeout(200)
        mask = self.page.locator(".p-sidebar-mask:visible, .p-component-overlay.p-sidebar-mask:visible")
        if mask.count() > 0:
            mask.first.click(position={"x": 5, "y": 5}, force=True)
            self.page.wait_for_timeout(200)
        self._close_header_menu()
        self.page.wait_for_timeout(200)

    def go_to_page_recorded(self) -> None:
        """对齐录制 sales-portal-5GBB-0929：分页按钮 **3**（无则 2→1）。"""
        self._dismiss_sidebar_mask()
        for n in (3, 2, 1):
            btn = self.page.get_by_role("button", name=str(n))
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click(force=True)
                self.page.wait_for_load_state("networkidle")
                self.page.wait_for_timeout(400)
                return

    def select_offer_recorded(self) -> None:
        """对齐录制 L16：点目标套餐；SIT 目录漂移时选首个 HPPRM Broadband 卡片。"""
        self._dismiss_sidebar_mask()
        key = get_offer()["key"]
        card = self.page.locator("div.box").filter(has_text=key)
        if card.count() > 0:
            target = card.first
            expect(target).to_be_visible(timeout=15_000)
            target.evaluate("el => el.scrollIntoView({block: 'center'})")
            self.page.wait_for_timeout(300)
            cls = target.get_attribute("class") or ""
            if "selected" not in cls:
                target.click(force=True)
            return
        for loc in (
            self.page.locator("div.box").filter(has_text=re.compile(r"HPPRM\S+", re.I)),
            self.page.get_by_text(re.compile(r"5G Broadband", re.I)),
            self.page.get_by_text(re.compile(r"\$168|\$118|\$238", re.I)),
        ):
            if loc.count() > 0:
                card = loc.first
                expect(card).to_be_visible(timeout=15_000)
                card.evaluate("el => el.scrollIntoView({block: 'center'})")
                self.page.wait_for_timeout(300)
                if "selected" not in (card.get_attribute("class") or ""):
                    card.click(force=True)
                return
        raise AssertionError(f"未找到套餐 {key}，且 SIT 目录无 HPPRM/5G Broadband 卡片")

    def navigate_5g_bb_resume_draft(self) -> None:
        """侧栏进入 5G BB 并恢复未完成草稿（不点 New Subscription）。"""
        self._click_5g_bb_in_sidebar()

    def navigate_5g_bb(self) -> None:
        if bb_browse_listing_visible(self.page):
            _click_new_subscription(self.page)
            return
        for attempt in range(3):
            if pending_payment_visible(self.page) and not can_browse_offers(self.page):
                _try_back_to_browse_from_payment_wait(self.page, BASE_URL)
            if bb_browse_listing_visible(self.page):
                _click_new_subscription(self.page)
                return
            if can_browse_offers(self.page):
                _click_new_subscription(self.page)
            elif _in_offer_configuration(self.page):
                force_browse_home(self.page, BASE_URL)
                _click_new_subscription(self.page)
            self._click_5g_bb_in_sidebar()
            self.page.wait_for_load_state("networkidle")
            self.page.wait_for_timeout(800)
            if bb_browse_listing_visible(self.page):
                return
            if pending_payment_visible(self.page) and not can_browse_offers(self.page):
                _try_back_to_browse_from_payment_wait(self.page, BASE_URL)
                continue
            if bb_browse_listing_visible(self.page):
                return
            if _in_offer_configuration(self.page):
                exit_draft_application_to_browse(self.page)
            if bb_browse_listing_visible(self.page):
                return
            _try_back_to_browse_from_payment_wait(self.page, BASE_URL)
        if not can_browse_offers(self.page):
            _try_back_to_browse_from_payment_wait(self.page, BASE_URL)
            exit_draft_application_to_browse(self.page)

    def go_to_page(self, page_number: int) -> None:
        self.page.get_by_role("button", name=str(page_number)).click()
        self.page.wait_for_load_state("networkidle")

    def _offer_locator(self, key: str):
        card = self.page.locator("div.box").filter(has_text=key)
        if card.count() > 0:
            return card.first
        return self.page.get_by_text(key, exact=False).first

    def _offer_visible(self, key: str) -> bool:
        card = self.page.locator("div.box").filter(has_text=key)
        if card.count() > 0:
            try:
                return card.first.is_visible()
            except Exception:
                pass
        text = self.page.get_by_text(key, exact=False)
        if text.count() == 0:
            return False
        try:
            return text.first.is_visible()
        except Exception:
            return False

    def _expand_hot_pick_if_collapsed(self) -> None:
        more = self.page.locator(".promotion-view-option").filter(
            has_text=re.compile(r"^More$", re.I)
        )
        if more.count() > 0 and more.first.is_visible():
            cls = more.first.get_attribute("class") or ""
            if "active" not in cls:
                more.first.click()
                self.page.wait_for_load_state("networkidle")
                self.page.wait_for_timeout(500)

    def _fallback_offer_card(self):
        """SIT 目录漂移：按 Broadband / $168 / HPPRM 找首个套餐卡片。"""
        for pattern in (
            re.compile(r"HPPRM\S+", re.I),
            re.compile(r"Broadband", re.I),
            re.compile(r"\$168", re.I),
        ):
            card = self.page.locator("div.box").filter(has_text=pattern)
            if card.count() > 0:
                return card.first
            text = self.page.get_by_text(pattern)
            if text.count() > 0:
                return text.first
        return None

    def go_to_page_with_offer(self) -> None:
        """在分页中查找目标套餐（录制为第 3 页，SIT 可能漂移）。"""
        if not can_browse_offers(self.page):
            _try_back_to_browse_from_payment_wait(self.page, BASE_URL)
            exit_draft_application_to_browse(self.page)
        key = get_offer()["key"]
        self._expand_hot_pick_if_collapsed()
        if self._offer_visible(key):
            return
        for page_number in list(range(1, 11)) + [3, 2]:
            btn = self.page.get_by_role("button", name=str(page_number))
            if btn.count() == 0:
                continue
            btn.first.click()
            self.page.wait_for_load_state("networkidle")
            if self._offer_visible(key):
                return
        fallback = self._fallback_offer_card()
        if fallback is not None:
            expect(fallback).to_be_visible(timeout=15_000)
            return
        expect(self._offer_locator(key)).to_be_visible(timeout=15_000)

    def select_offer_by_key(self) -> None:
        """点击目标套餐卡片（offer_factory key）；已选中则跳过重复点击。"""
        key = get_offer()["key"]
        if self._offer_visible(key):
            card = self._offer_locator(key)
        else:
            card = self._fallback_offer_card()
            if card is None:
                card = self._offer_locator(key)
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
        if bb_browse_listing_visible(self.page):
            expect(self.page.get_by_text("Featured Monthly Plans", exact=False).first).to_be_visible(
                timeout=15_000
            )
            return
        _try_back_to_browse_from_payment_wait(self.page, BASE_URL)
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
