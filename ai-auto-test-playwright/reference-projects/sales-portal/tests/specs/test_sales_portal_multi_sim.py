"""Sales Portal Multi-SIM 全流程 smoke（sales-portal-multi-sim TC-100：Online / Cashier / Direct Sale / Fortress）。"""
import os
import re

import pytest
from playwright.sync_api import Page, expect

from conftest import BASE_URL
from data.address_factory import get_0929_defaults
from data.hkid_factory import (
    mark_hkid_deposit_conflict,
    mark_hkid_ocr_failure,
    mark_hkid_used,
    pool_remaining_count,
    release_hkid_allocation,
    should_track_hkid_usage,
)
from data.offer_factory import get_multi_sim_line_count
from data.sim_factory import mark_sim_pair_used, should_track_sim_usage
from helpers.cashier_sit_topup import install_payment_txn_capture
from pages.address_page import AddressPage
from pages.checkout_helpers import _sim_visible, proceed_to_sim_step
from pages.fortress_shop_page import FortressShopPage
from pages.gateway_payment_page import GatewayPaymentPage
from pages.kyc_page import KycPage
from pages.order_application_page import OrderApplicationPage
from pages.overlay_helpers import (
    DepositCartHkidRetry,
    KycOcrHkidRetry,
    can_browse_multi_sim_offers,
    cart_amount_looks_stale,
    check_deposit_or_raise_hkid_retry,
    clear_pending_payment_order,
    clear_stale_multi_sim_draft,
    deposit_cart_mismatch_visible,
    dismiss_shop_cart_drawer,
    pending_payment_visible,
    resolve_deposit_cart_mismatch,
    _click_new_subscription,
)
from pages.payment_method_page import PaymentMethodPage
from pages.payment_page import PaymentPage
from pages.payment_result_page import PaymentResultPage
from pages.activation_date_page import ActivationDatePage
from pages.phone_selection_page import PhoneSelectionPage
from pages.product_listing_page import ProductListingPage
from pages.sim_service_page import SimServicePage
from pages.step8_complete_page import Step8CompletePage


@pytest.fixture(autouse=True)
def sales_portal_multi_sim_env(monkeypatch: pytest.MonkeyPatch) -> None:
    defaults = get_0929_defaults()
    monkeypatch.setenv("SALES_PORTAL_CARD_EXP", os.getenv("SALES_PORTAL_CARD_EXP", "1039"))
    monkeypatch.setenv("SALES_PORTAL_TEST_SUGGESTION", defaults["suggestion"])
    monkeypatch.setenv("SALES_PORTAL_TEST_BLOCK", defaults["block"])
    monkeypatch.setenv("SALES_PORTAL_TEST_FLOOR", defaults["floor"])
    monkeypatch.setenv("SALES_PORTAL_TEST_ROOM", defaults["room"])


class TestSalesPortalMultiSim:
    def _start_fresh_browse(self, page: Page) -> None:
        if cart_amount_looks_stale(page) or deposit_cart_mismatch_visible(page):
            clear_stale_multi_sim_draft(page, BASE_URL)
        resolve_deposit_cart_mismatch(page, BASE_URL)
        body = page.locator("body").inner_text()
        if "Waiting for payment done" in body or (
            pending_payment_visible(page) and not can_browse_multi_sim_offers(page)
        ):
            if clear_stale_multi_sim_draft(page, BASE_URL):
                return
        for _ in range(3):
            if pending_payment_visible(page) and not can_browse_multi_sim_offers(page):
                if clear_stale_multi_sim_draft(page, BASE_URL):
                    return
                back = page.get_by_role("button", name=re.compile(r"Back to index", re.I))
                if back.count() > 0 and back.first.is_visible():
                    back.first.click()
                    page.wait_for_load_state("networkidle")
            clear_pending_payment_order(page, BASE_URL)
            if can_browse_multi_sim_offers(page) and not pending_payment_visible(page):
                break

    def _advance_phone_steps(self, page: Page, phone: PhoneSelectionPage) -> None:
        phone.advance_multi_sim_phone_steps()

    def _reach_offer(self, listing: ProductListingPage) -> None:
        """Multi-SIM：browse → 选套餐 → chevron → 选号（可多轮）→ KYC 可见。"""
        page = listing.page
        self._start_fresh_browse(page)
        phone = PhoneSelectionPage(page)
        for attempt in range(2):
            _click_new_subscription(page)
            listing.navigate_multi_sim_recorded()
            listing.select_multi_sim_offer()
            self._advance_phone_steps(page, phone)
            if _sim_visible(page):
                clear_pending_payment_order(page, BASE_URL)
                listing.navigate_multi_sim_recorded()
                continue
            kyc_input = page.get_by_role(
                "textbox", name=re.compile(r"Test ID number", re.I)
            )
            try:
                expect(kyc_input.first).to_be_visible(timeout=20_000)
                return
            except AssertionError:
                if attempt == 0:
                    if "select-date" in (page.url or "").lower():
                        ActivationDatePage(page).advance_past_activation_date(
                            pick_first_cell=False
                        )
                        continue
                    clear_pending_payment_order(page, BASE_URL)
                    listing.navigate_multi_sim_recorded()
                    continue
                snippet = ""
                try:
                    snippet = (page.locator("body").inner_text() or "")[:400].replace("\n", " ")
                except Exception:
                    pass
                raise AssertionError(
                    "Multi-SIM 选套餐/选号后未进入 KYC（Test ID）。"
                    f" url={page.url!r} body≈{snippet!r}。"
                ) from None
        raise AssertionError("Multi-SIM 选套餐后仍无法进入 KYC，请 SIT 取消未完成订单后重试")

    def _kyc_address_payment(self, page: Page) -> tuple[OrderApplicationPage, KycPage]:
        order = OrderApplicationPage(page)
        kyc = KycPage(page)
        kyc.fill_hkid_and_upload()
        kyc.ensure_id_verified()
        check_deposit_or_raise_hkid_retry(page, BASE_URL)
        kyc.select_identity_method(3)
        kyc.fill_contact_mobile()
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
        payment.advance_after_payment_signature()
        return order, kyc

    def _wizard_through_sim_with_hkid_retry(
        self, page: Page
    ) -> tuple[OrderApplicationPage, KycPage, SimServicePage]:
        max_hkid_retries = 15 if should_track_hkid_usage() else 3
        order: OrderApplicationPage | None = None
        kyc: KycPage | None = None
        listing = ProductListingPage(page)
        line_count = get_multi_sim_line_count()
        for hkid_attempt in range(max_hkid_retries):
            try:
                if hkid_attempt > 0:
                    self._reach_offer(listing)
                order, kyc = self._kyc_address_payment(page)
                check_deposit_or_raise_hkid_retry(page, BASE_URL)
                proceed_to_sim_step(page)
                check_deposit_or_raise_hkid_retry(page, BASE_URL)
                break
            except (DepositCartHkidRetry, KycOcrHkidRetry) as exc:
                bad = kyc.last_hkid if kyc else None
                print(f"[multi-sim tc100] HKID retry {hkid_attempt + 1}/{max_hkid_retries}: {exc}")
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
                clear_stale_multi_sim_draft(page, BASE_URL)
        else:
            raise AssertionError(
                f"deposit/cart 报错已换 {max_hkid_retries} 个 HKID 仍失败；"
                f"pool 剩余≈{pool_remaining_count()}"
            )

        assert order is not None and kyc is not None
        sim = SimServicePage(page)
        sim.fill_sim_ids(lines=line_count)
        sim.agree_terms()
        sim.sign_consent()
        return order, kyc, sim

    def _mark_pool_usage(self, kyc: KycPage, sim: SimServicePage) -> None:
        if should_track_hkid_usage() and kyc.last_hkid:
            mark_hkid_used(kyc.last_hkid, reason="order_success")
        if should_track_sim_usage():
            pairs = sim.last_sim_pairs or ([sim.last_sim_pair] if sim.last_sim_pair else [])
            seen: set[str] = set()
            for pair in pairs:
                if pair and pair[0] not in seen:
                    seen.add(pair[0])
                    mark_sim_pair_used(pair[0], reason="order_success")

    def _assert_no_gateway_popup(self, page: Page, *, wait_ms: int = 5_000) -> None:
        ctx = page.context
        count_before = len(ctx.pages)
        page.wait_for_timeout(wait_ms)
        for p in ctx.pages[count_before:]:
            if p.is_closed():
                continue
            url = p.url or ""
            if "paygwuat" in url or "checkout/transaction" in url:
                raise AssertionError(f"非 Online 路径不应打开支付网关: {url}")

    @pytest.mark.smoke
    def test_tc100_multi_sim_online_payment(self, logged_in_page_simonly: Page) -> None:
        page = logged_in_page_simonly
        self._reach_offer(ProductListingPage(page))
        order, kyc, sim = self._wizard_through_sim_with_hkid_retry(page)

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
        self._mark_pool_usage(kyc, sim)

    @pytest.mark.smoke
    def test_tc100_multi_sim_cash_payment(self, logged_in_page_simonly: Page) -> None:
        page = logged_in_page_simonly
        install_payment_txn_capture(page)
        self._reach_offer(ProductListingPage(page))
        order, kyc, sim = self._wizard_through_sim_with_hkid_retry(page)

        order.next_step()
        pm = PaymentMethodPage(page)
        pm.expect_on_step()
        pm.pick_cashier()
        order.next_step()
        self._assert_no_gateway_popup(page)

        step8 = Step8CompletePage(page)
        step8.complete_cashier_via_status_check()
        PaymentResultPage(page).back_to_index()

        expect(page.locator("app-new-header")).to_be_visible(timeout=30_000)
        self._mark_pool_usage(kyc, sim)

    @pytest.mark.smoke
    def test_tc100_multi_sim_direct_sale_payment(self, logged_in_page_sdir: Page) -> None:
        page = logged_in_page_sdir
        self._reach_offer(ProductListingPage(page))
        OrderApplicationPage(page).fill_second_agent_if_required()
        order, kyc, sim = self._wizard_through_sim_with_hkid_retry(page)

        from conftest import recover_portal_session_if_needed

        order.next_step()
        recover_portal_session_if_needed(page)
        pm = PaymentMethodPage(page)
        pm.expect_on_step()
        pm.pick_direct_sale_payment()
        order.next_step()
        self._assert_no_gateway_popup(page)

        step8 = Step8CompletePage(page)
        step8.complete_direct_sale_via_status_check()
        PaymentResultPage(page).back_to_index()

        expect(page.locator("app-new-header")).to_be_visible(timeout=30_000)
        self._mark_pool_usage(kyc, sim)

    @pytest.mark.smoke
    def test_tc100_multi_sim_fortress_payment(self, logged_in_page_fortress: Page) -> None:
        page = logged_in_page_fortress
        self._reach_offer(ProductListingPage(page))
        FortressShopPage(page).prepare_after_select_offer()
        order, kyc, sim = self._wizard_through_sim_with_hkid_retry(page)

        order.next_step()
        pm = PaymentMethodPage(page)
        pm.expect_on_step()
        pm.pick_fortress_payment()
        order.next_step()
        self._assert_no_gateway_popup(page)

        step8 = Step8CompletePage(page)
        step8.complete_fortress_via_status_check()
        PaymentResultPage(page).back_to_index()

        expect(page.locator("app-new-header")).to_be_visible(timeout=30_000)
        self._mark_pool_usage(kyc, sim)
