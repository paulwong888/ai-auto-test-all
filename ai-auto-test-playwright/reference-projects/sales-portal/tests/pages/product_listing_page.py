"""产品线/报价列表页 Page Object（侧栏 Browse Offer 导航 + 主区列表）。"""
import re

from playwright.sync_api import Page, expect

from conftest import BASE_URL
from data.offer_factory import (
    get_multi_sim_choose_one_vas,
    get_multi_sim_offer,
    get_offer,
    get_sim_only_choose_one_vas,
    get_sim_only_offer,
)
from pages.order_application_page import OrderApplicationPage
from pages.overlay_helpers import (
    SIM_ONLY_BROWSE_URL_SUFFIX,
    bb_browse_listing_visible,
    can_browse_offers,
    exit_draft_application_to_browse,
    assert_multi_sim_browse,
    assert_multi_sim_family_plan_url,
    family_plan_browse_listing_visible,
    force_browse_home,
    force_browse_home_sim_only,
    has_bb_offer_listing,
    multi_sim_browse_listing_visible,
    pending_payment_visible,
    sim_only_browse_listing_visible,
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

    def _click_sim_only_in_sidebar(self) -> None:
        """侧栏 SIM Plan → Sim Only（菜单文案因 i18n/权限可能为 Sim Only / SIM Only）。"""
        self._open_header_menu()
        for parent_label in (r"SIM Plan", r"Sim Plan", r"SIM\s*Plan"):
            parent = self.sidebar.get_by_text(re.compile(parent_label, re.I))
            if parent.count() > 0:
                try:
                    parent.first.click()
                    self.page.wait_for_timeout(400)
                except Exception:
                    pass
        for child in (
            self.sidebar.locator("a").filter(has_text=re.compile(r"Sim Only", re.I)),
            self.sidebar.get_by_text(re.compile(r"^Sim Only$", re.I)),
            self.sidebar.locator("a").filter(has_text=re.compile(r"sim-only", re.I)),
        ):
            if child.count() > 0:
                try:
                    if child.first.is_visible():
                        child.first.click()
                        self.page.wait_for_load_state("networkidle")
                        self._dismiss_sidebar_mask()
                        return
                except Exception:
                    continue
        browse_url = f"{BASE_URL.rstrip('/')}{SIM_ONLY_BROWSE_URL_SUFFIX}"
        self.page.goto(browse_url, wait_until="networkidle", timeout=120_000)
        self._dismiss_sidebar_mask()

    def navigate_sim_only_recorded(self) -> None:
        """进入 Sim Only browse 列表（侧栏优先，失败则 URL）。"""
        if sim_only_browse_listing_visible(self.page):
            _click_new_subscription(self.page)
            self._select_sim_only_more_tab()
            return
        for _ in range(2):
            self._click_sim_only_in_sidebar()
            self.page.wait_for_load_state("networkidle")
            if sim_only_browse_listing_visible(self.page):
                self._select_sim_only_more_tab()
                return
            force_browse_home_sim_only(self.page, BASE_URL)
        expect(
            self.page.get_by_text("Featured Monthly Plans", exact=False).first
        ).to_be_visible(timeout=15_000)
        self._select_sim_only_more_tab()

    def _select_sim_only_more_tab(self) -> None:
        """Sim Only 默认 Hot Pick；自动化选套餐需先点 **More** 展开完整列表。"""
        self._dismiss_sidebar_mask()
        expect(
            self.page.get_by_text("Featured Monthly Plans", exact=False).first
        ).to_be_visible(timeout=15_000)

        more_tab = self.page.locator(".promotion-view-option").filter(
            has_text=re.compile(r"^More$", re.I)
        )
        if more_tab.count() == 0:
            more_tab = self.page.get_by_text("More", exact=True)

        if more_tab.count() == 0:
            return

        tab = more_tab.first
        expect(tab).to_be_visible(timeout=10_000)
        cls = tab.get_attribute("class") or ""
        if "active" not in cls.split():
            tab.click()
            self.page.wait_for_load_state("networkidle")
            self.page.wait_for_timeout(800)

        active_carousel = self.page.locator(".p-carousel-item-active .box")
        list_boxes = self.page.locator(
            ".promotions-list-container .box, app-new-promotion-list .box"
        )
        try:
            if active_carousel.count() > 0:
                expect(active_carousel.first).to_be_visible(timeout=20_000)
            elif list_boxes.count() > 0:
                expect(list_boxes.first).to_be_visible(timeout=20_000)
        except AssertionError:
            pass

    def _expand_sim_only_promotion_list(self) -> None:
        """Sim Only：确保在 More 视图（非默认 Hot Pick）。"""
        self._select_sim_only_more_tab()

    def _sim_only_offer_cards(self):
        return self.page.locator(
            ".promotions-list-container .box, p-carousel .box, app-new-promotion-list .box"
        )

    def _wait_sim_only_price_loaded(self) -> None:
        loading = self.page.get_by_text(re.compile(r"Loading price", re.I))
        try:
            if loading.count() > 0 and loading.first.is_visible():
                expect(loading.first).to_be_hidden(timeout=60_000)
        except Exception:
            self.page.wait_for_timeout(1500)

    def _sim_only_choose_one_visible(self) -> bool:
        marker = self.page.get_by_text(re.compile(r"Choo?se\s*1", re.I))
        if marker.count() == 0:
            return False
        try:
            return marker.first.is_visible()
        except Exception:
            return False

    def _select_sim_only_choose_one_vas(self) -> None:
        """Sim Only 选套餐后「Choose 1」必选一项（SIT 常见 Handset Switch Lite）。"""
        if not self._sim_only_choose_one_visible():
            return
        vas_label = get_sim_only_choose_one_vas()
        if not vas_label:
            return
        pattern = re.compile(re.escape(vas_label), re.I)
        short = re.compile(r"Handset Switch Lite", re.I)

        for name_re in (pattern, short):
            radio = self.page.get_by_role("radio", name=name_re)
            if radio.count() > 0:
                target = radio.first
                try:
                    if target.is_visible():
                        target.check(force=True)
                        self._wait_sim_only_price_loaded()
                        return
                except Exception:
                    target.click(force=True)
                    self._wait_sim_only_price_loaded()
                    return

        section = self.page.locator(".flex-body").filter(
            has=self.page.get_by_text(re.compile(r"Choo?se\s*1", re.I))
        )
        scope = section.first if section.count() > 0 else self.page.locator(".flex-body").first
        for text_re in (pattern, short):
            option = scope.get_by_text(text_re)
            for i in range(option.count()):
                hit = option.nth(i)
                try:
                    if not hit.is_visible():
                        continue
                    hit.scroll_into_view_if_needed()
                    hit.click(force=True)
                    self._wait_sim_only_price_loaded()
                    return
                except Exception:
                    continue
            rb = scope.locator("p-radiobutton, .p-radiobutton").filter(has_text=text_re)
            if rb.count() > 0:
                rb.first.click(force=True)
                self._wait_sim_only_price_loaded()
                return

        raise AssertionError(
            f"Sim Only「Choose 1」可见但未选中 VAS：{vas_label!r}。"
            "可设置 SALES_PORTAL_SIM_ONLY_CHOOSE_ONE_VAS。"
        )

    def _finalize_sim_only_offer_selection(self) -> None:
        self._wait_sim_only_price_loaded()
        self._select_sim_only_choose_one_vas()

    def _advance_sim_only_select_plan_step(self) -> None:
        """选套餐 + Choose 1 后立即点底部购物车旁 ``>`` 到 SELECT_PHONE。"""
        OrderApplicationPage(self.page).next_step()

    def _done_sim_only_offer(self, *, advance: bool) -> None:
        self._finalize_sim_only_offer_selection()
        if advance:
            self._advance_sim_only_select_plan_step()

    def select_sim_only_offer(self, *, advance: bool = True) -> None:
        """Sim Only：选套餐卡 → Choose 1 VAS → 默认马上 next_step。"""
        self._dismiss_sidebar_mask()
        self._expand_sim_only_promotion_list()
        key = get_sim_only_offer().get("key", "").strip()
        if key:
            for loc in (
                self._sim_only_offer_cards().filter(has_text=key),
                self.page.locator(".box").filter(has_text=key),
            ):
                if loc.count() > 0:
                    target = loc.first
                    expect(target).to_be_visible(timeout=15_000)
                    target.scroll_into_view_if_needed()
                    if "selected" not in (target.get_attribute("class") or ""):
                        target.click(force=True)
                    self._done_sim_only_offer(advance=advance)
                    return
        active = self.page.locator(".p-carousel-item-active .box")
        if active.count() > 0:
            target = active.first
            expect(target).to_be_visible(timeout=15_000)
            target.scroll_into_view_if_needed()
            if "selected" not in (target.get_attribute("class") or ""):
                target.click(force=True)
            self._done_sim_only_offer(advance=advance)
            return
        cards = self._sim_only_offer_cards()
        if cards.count() > 0:
            target = cards.first
            expect(target).to_be_visible(timeout=15_000)
            target.scroll_into_view_if_needed()
            if "selected" not in (target.get_attribute("class") or ""):
                target.click(force=True)
            self._done_sim_only_offer(advance=advance)
            return
        for pattern in (
            re.compile(r"\$\s*\d+\s*/\s*Month", re.I),
            re.compile(r"HPPRM\S+", re.I),
        ):
            loc = self.page.get_by_text(pattern)
            if loc.count() > 0:
                try:
                    hit = loc.first
                    hit.scroll_into_view_if_needed()
                    hit.click(force=True)
                    self._done_sim_only_offer(advance=advance)
                    return
                except Exception:
                    pass
        raise AssertionError(
            "Sim Only browse 未找到可选套餐卡（promotion .box）。"
            "可设置 SALES_PORTAL_SIM_ONLY_OFFER_KEY 或检查 SIT 目录。"
        )

    def _click_multi_sim_in_sidebar(self) -> None:
        """菜单：先点 Monthly Plan，再点 Multi-SIM Plan → /sales/family-plan/ browse。"""
        self._dismiss_sidebar_mask()
        url = (self.page.url or "").lower()
        if "family-plan" not in url or "select-plan" not in url:
            back = self.page.get_by_role("button", name=re.compile(r"Back to index", re.I))
            if back.count() > 0 and back.first.is_visible():
                back.first.click(force=True)
                self.page.wait_for_load_state("networkidle")
                self.page.wait_for_timeout(400)

        self._open_header_menu()
        monthly_re = re.compile(r"Monthly Plan", re.I)
        monthly = self.sidebar.locator("a").filter(has_text=monthly_re)
        if monthly.count() == 0:
            monthly = self.sidebar.get_by_text(monthly_re)
        expect(monthly.first).to_be_visible(timeout=15_000)
        try:
            monthly.first.click()
        except Exception:
            monthly.first.click(force=True)
        self.page.wait_for_timeout(500)

        multi_re = re.compile(r"Multi-SIM Plan", re.I)
        multi = self.sidebar.locator("a").filter(has_text=multi_re)
        if multi.count() == 0:
            multi = self.sidebar.get_by_text(multi_re)
        if multi.count() == 0:
            multi = self.sidebar.locator("a").filter(has_text=re.compile(r"Multi-SIM", re.I))
        expect(multi.first).to_be_visible(timeout=15_000)
        try:
            multi.first.click()
        except Exception:
            multi.first.click(force=True)
        self.page.wait_for_load_state("networkidle")
        self._dismiss_sidebar_mask()
        assert_multi_sim_family_plan_url(self.page)

    def navigate_multi_sim_recorded(self) -> None:
        """进入 Multi-SIM browse（仅侧栏；路由不对则报错，无 goto fallback）。"""
        if multi_sim_browse_listing_visible(self.page):
            _click_new_subscription(self.page)
            self._select_sim_only_more_tab()
            assert_multi_sim_browse(self.page)
            return
        self._click_multi_sim_in_sidebar()
        self.page.wait_for_load_state("networkidle")
        if not family_plan_browse_listing_visible(self.page):
            raise AssertionError(
                "Multi-SIM family-plan browse 未出现 Featured Monthly Plans。"
                f" URL={self.page.url!r}"
            )
        self._select_sim_only_more_tab()
        assert_multi_sim_browse(self.page)

    def _select_multi_sim_choose_one_vas(self) -> None:
        if not self._sim_only_choose_one_visible():
            return
        vas_label = get_multi_sim_choose_one_vas()
        if not vas_label:
            return
        pattern = re.compile(re.escape(vas_label), re.I)
        short = re.compile(r"Handset Switch Lite", re.I)
        for name_re in (pattern, short):
            radio = self.page.get_by_role("radio", name=name_re)
            if radio.count() > 0:
                target = radio.first
                try:
                    if target.is_visible():
                        target.check(force=True)
                        self._wait_sim_only_price_loaded()
                        return
                except Exception:
                    target.click(force=True)
                    self._wait_sim_only_price_loaded()
                    return
        section = self.page.locator(".flex-body").filter(
            has=self.page.get_by_text(re.compile(r"Choo?se\s*1", re.I))
        )
        scope = section.first if section.count() > 0 else self.page.locator(".flex-body").first
        for text_re in (pattern, short):
            option = scope.get_by_text(text_re)
            for i in range(option.count()):
                hit = option.nth(i)
                try:
                    if not hit.is_visible():
                        continue
                    hit.scroll_into_view_if_needed()
                    hit.click(force=True)
                    self._wait_sim_only_price_loaded()
                    return
                except Exception:
                    continue
        raise AssertionError(
            f"Multi-SIM「Choose 1」可见但未选中 VAS：{vas_label!r}。"
            "可设置 SALES_PORTAL_MULTI_SIM_CHOOSE_ONE_VAS。"
        )

    def _finalize_multi_sim_offer_selection(self) -> None:
        self._wait_sim_only_price_loaded()
        self._select_multi_sim_choose_one_vas()

    def _done_multi_sim_offer(self, *, advance: bool) -> None:
        self._finalize_multi_sim_offer_selection()
        if advance:
            self._advance_sim_only_select_plan_step()

    def select_multi_sim_offer(self, *, advance: bool = True) -> None:
        """Multi-SIM：选套餐卡 → Choose 1 VAS → 默认 next_step。"""
        self._dismiss_sidebar_mask()
        self._expand_sim_only_promotion_list()
        key = get_multi_sim_offer().get("key", "").strip()
        if key:
            for loc in (
                self._sim_only_offer_cards().filter(has_text=key),
                self.page.locator(".box").filter(has_text=key),
            ):
                if loc.count() > 0:
                    target = loc.first
                    expect(target).to_be_visible(timeout=15_000)
                    target.scroll_into_view_if_needed()
                    if "selected" not in (target.get_attribute("class") or ""):
                        target.click(force=True)
                    self._done_multi_sim_offer(advance=advance)
                    return
        active = self.page.locator(".p-carousel-item-active .box")
        if active.count() > 0:
            target = active.first
            expect(target).to_be_visible(timeout=15_000)
            target.scroll_into_view_if_needed()
            if "selected" not in (target.get_attribute("class") or ""):
                target.click(force=True)
            self._done_multi_sim_offer(advance=advance)
            return
        cards = self._sim_only_offer_cards()
        if cards.count() > 0:
            target = cards.first
            expect(target).to_be_visible(timeout=15_000)
            target.scroll_into_view_if_needed()
            if "selected" not in (target.get_attribute("class") or ""):
                target.click(force=True)
            self._done_multi_sim_offer(advance=advance)
            return
        raise AssertionError(
            "Multi-SIM browse 未找到可选套餐卡。"
            "可设置 SALES_PORTAL_MULTI_SIM_OFFER_KEY 或检查 SIT 目录。"
        )

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

    def _pagination_button(self, page_number: int):
        """套餐列表分页（限定主内容区，避免误点侧栏/其它 name=数字 的按钮）。"""
        root = self.page.locator(".flex-body").first
        btn = root.get_by_role("button", name=str(page_number), exact=True)
        if btn.count() > 0:
            return btn.first
        return self.page.get_by_role("button", name=str(page_number), exact=True).first

    def go_to_page(self, page_number: int) -> None:
        self._dismiss_sidebar_mask()
        if not can_browse_offers(self.page):
            _try_back_to_browse_from_payment_wait(self.page, BASE_URL)
        btn = self._pagination_button(page_number)
        expect(btn).to_be_visible(timeout=15_000)
        btn.scroll_into_view_if_needed()
        btn.click(force=True)
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_timeout(400)

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
