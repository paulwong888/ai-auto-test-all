"""Sales Portal 5G BB 在线支付全流程（对齐录制 sales-portal-5GBB-0929）。

0929 模块 env 默认（可用 monkeypatch 覆盖）：
  SALES_PORTAL_CARD_EXP=1039
  SALES_PORTAL_TEST_SUGGESTION=1A YEN CHOW STREET, BLOCK A,
  SALES_PORTAL_TEST_BLOCK/FLOOR/ROOM=1/2/3
"""
import os
import re

import pytest
from playwright.sync_api import Page, expect

from data.address_factory import get_0929_defaults
from data.hkid_factory import (
    mark_hkid_deposit_conflict,
    mark_hkid_ocr_failure,
    mark_hkid_used,
    pool_remaining_count,
    release_hkid_allocation,
    should_track_hkid_usage,
)
from data.sim_factory import mark_sim_pair_used, should_track_sim_usage
from pages.address_page import AddressPage
from pages.checkout_helpers import proceed_to_sim_step
from pages.gateway_payment_page import GatewayPaymentPage
from pages.kyc_page import KycPage
from pages.order_application_page import OrderApplicationPage
from conftest import BASE_URL
from pages.checkout_helpers import _sim_visible
from pages.overlay_helpers import (
    DepositCartHkidRetry,
    KycOcrHkidRetry,
    can_browse_offers,
    cart_amount_looks_stale,
    check_deposit_or_raise_hkid_retry,
    clear_pending_payment_order,
    clear_stale_5g_bb_draft,
    deposit_cart_mismatch_visible,
    dismiss_shop_cart_drawer,
    force_browse_home,
    pending_payment_visible,
    resolve_deposit_cart_mismatch,
    _click_new_subscription,
)
from pages.payment_method_page import PaymentMethodPage
from pages.payment_page import PaymentPage
from pages.payment_result_page import PaymentResultPage
from pages.product_listing_page import ProductListingPage
from pages.sim_service_page import SimServicePage
from pages.step8_complete_page import Step8CompletePage


@pytest.fixture(autouse=True)
def sales_portal_0929_env(monkeypatch: pytest.MonkeyPatch) -> None:
    defaults = get_0929_defaults()
    monkeypatch.setenv("SALES_PORTAL_CARD_EXP", os.getenv("SALES_PORTAL_CARD_EXP", "1039"))
    monkeypatch.setenv("SALES_PORTAL_TEST_SUGGESTION", defaults["suggestion"])
    monkeypatch.setenv("SALES_PORTAL_TEST_BLOCK", defaults["block"])
    monkeypatch.setenv("SALES_PORTAL_TEST_FLOOR", defaults["floor"])
    monkeypatch.setenv("SALES_PORTAL_TEST_ROOM", defaults["room"])


class TestSalesPortal5GBB0929:
    def _start_fresh_browse(self, page: Page) -> None:
        if cart_amount_looks_stale(page) or deposit_cart_mismatch_visible(page):
            clear_stale_5g_bb_draft(page, BASE_URL)
        resolve_deposit_cart_mismatch(page, BASE_URL)
        body = page.locator("body").inner_text()
        if "Waiting for payment done" in body or (
            pending_payment_visible(page) and not can_browse_offers(page)
        ):
            if clear_stale_5g_bb_draft(page, BASE_URL):
                return
        for _ in range(3):
            if pending_payment_visible(page) and not can_browse_offers(page):
                if clear_stale_5g_bb_draft(page, BASE_URL):
                    return
                back = page.get_by_role("button", name=re.compile(r"Back to index", re.I))
                if back.count() > 0 and back.first.is_visible():
                    back.first.click()
                    page.wait_for_load_state("networkidle")
                else:
                    force_browse_home(page, BASE_URL)
            clear_pending_payment_order(page, BASE_URL)
            if can_browse_offers(page) and not pending_payment_visible(page):
                break
            force_browse_home(page, BASE_URL)

    def _finish_step8_online_payment(self, page: Page) -> None:
        step8 = Step8CompletePage(page)
        step8.expect_waiting_payment()
        popup = step8.obtain_gateway_popup(page.context)
        GatewayPaymentPage(popup).complete_payment()
        if not popup.is_closed():
            popup.close()
        page.bring_to_front()
        page.wait_for_load_state("networkidle")
        result = PaymentResultPage(page)
        result.check_payment_status()
        result.close_status_overlay()
        result.back_to_index()

    def _try_finish_resumed_step8(self, page: Page) -> bool:
        """SIT 无 fresh 套餐时，恢复 5G BB 草稿并完成 Step8 在线支付。"""
        if pending_payment_visible(page) and not can_browse_offers(page):
            self._finish_step8_online_payment(page)
            return True
        ProductListingPage(page).navigate_5g_bb_resume_draft()
        if pending_payment_visible(page) and not can_browse_offers(page):
            self._finish_step8_online_payment(page)
            return True
        return False

    def _reach_offer(self, listing: ProductListingPage) -> None:
        """对齐录制 sales-portal-5GBB-0929：菜单→5G BB→第3页→选套餐→chevron-right。"""
        page = listing.page
        self._start_fresh_browse(page)
        for attempt in range(2):
            _click_new_subscription(page)
            listing.navigate_5g_bb_recorded()
            listing.go_to_page_recorded()
            listing.select_offer_recorded()
            page.locator(".pi.pi-chevron-right").first.click(force=True)
            page.wait_for_load_state("networkidle")
            if not _sim_visible(page):
                return
            force_browse_home(page, BASE_URL)
            clear_pending_payment_order(page, BASE_URL)
        raise AssertionError("选套餐后仍进入 SIM/激活日草稿，请 SIT 取消未完成订单后重试")

    def _kyc_address_payment(self, page: Page) -> tuple[OrderApplicationPage, KycPage]:
        """KYC → 地址 → 信用卡（含 Consent 签名前）；遇 deposit 报错由外层换 HKID 重试。"""
        order = OrderApplicationPage(page)
        kyc = KycPage(page)
        kyc.fill_hkid_and_upload()
        kyc.ensure_id_verified()
        check_deposit_or_raise_hkid_retry(page, BASE_URL)
        kyc.select_identity_method(3)
        kyc.fill_contact_mobile()
        kyc.ensure_mobile_verified()
        check_deposit_or_raise_hkid_retry(page, BASE_URL)

        address = AddressPage(page)
        address.fill_all()
        check_deposit_or_raise_hkid_retry(page, BASE_URL)

        dismiss_shop_cart_drawer(page, BASE_URL)
        payment = PaymentPage(page)
        payment.fill_card_number()
        payment.sign_card()
        payment.fill_name_on_card()
        payment.fill_expiration()
        check_deposit_or_raise_hkid_retry(page, BASE_URL)
        payment.sign_inline()
        return order, kyc

    @pytest.mark.smoke
    def test_tc100_5gbb_online_payment(self, logged_in_page: Page) -> None:
        page = logged_in_page

        if self._try_finish_resumed_step8(page):
            expect(page.locator("app-new-header")).to_be_visible(timeout=30_000)
            return

        try:
            self._reach_offer(ProductListingPage(page))
        except AssertionError:
            if self._try_finish_resumed_step8(page):
                expect(page.locator("app-new-header")).to_be_visible(timeout=30_000)
                return
            raise

        max_hkid_retries = 15 if should_track_hkid_usage() else 3
        order: OrderApplicationPage | None = None
        kyc: KycPage | None = None
        for hkid_attempt in range(max_hkid_retries):
            try:
                if hkid_attempt > 0:
                    self._reach_offer(ProductListingPage(page))
                order, kyc = self._kyc_address_payment(page)
                check_deposit_or_raise_hkid_retry(page, BASE_URL)
                proceed_to_sim_step(page)
                check_deposit_or_raise_hkid_retry(page, BASE_URL)
                break
            except (DepositCartHkidRetry, KycOcrHkidRetry) as exc:
                bad = kyc.last_hkid if kyc else None
                print(f"[tc100] HKID retry {hkid_attempt + 1}/{max_hkid_retries}: {exc}")
                if bad:
                    if should_track_hkid_usage():
                        if isinstance(exc, KycOcrHkidRetry):
                            mark_hkid_ocr_failure(bad)
                        else:
                            mark_hkid_deposit_conflict(bad)
                    else:
                        release_hkid_allocation()
                else:
                    release_hkid_allocation()
                clear_stale_5g_bb_draft(page, BASE_URL)
                force_browse_home(page, BASE_URL)
        else:
            raise AssertionError(
                f"deposit/cart 报错已换 {max_hkid_retries} 个 HKID 仍失败；"
                f"pool 剩余≈{pool_remaining_count()}"
            )

        assert order is not None and kyc is not None

        sim = SimServicePage(page)
        sim.fill_sim_ids()
        sim.agree_terms()
        sim.sign_consent()

        order.next_step()

        pm = PaymentMethodPage(page)
        pm.expect_on_step()
        pm.pick_online_payment()

        step8 = Step8CompletePage(page)
        popup = step8.obtain_gateway_popup(page.context, on_trigger=lambda: order.next_step())

        GatewayPaymentPage(popup).complete_payment()
        if not popup.is_closed():
            popup.close()
        page.bring_to_front()
        page.wait_for_load_state("networkidle")

        result = PaymentResultPage(page)
        result.check_payment_status()
        result.close_status_overlay()
        result.back_to_index()

        expect(page.locator("app-new-header")).to_be_visible(timeout=30_000)

        if should_track_hkid_usage() and kyc.last_hkid:
            mark_hkid_used(kyc.last_hkid, reason="order_success")

        if should_track_sim_usage() and sim.last_sim_pair:
            mark_sim_pair_used(sim.last_sim_pair[0])
