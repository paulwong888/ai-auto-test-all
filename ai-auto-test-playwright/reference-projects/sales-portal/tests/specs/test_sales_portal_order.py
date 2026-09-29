"""Sales Portal 下单 smoke（对齐录制 + SIT OTP/购物车浮层处理）。"""
import re

import pytest
from playwright.sync_api import Page, expect

from pages.address_page import AddressPage
from pages.kyc_page import KycPage
from pages.order_application_page import OrderApplicationPage
from pages.overlay_helpers import dismiss_shop_cart_drawer
from pages.payment_page import PaymentPage
from pages.checkout_helpers import proceed_to_sim_step
from pages.product_listing_page import ProductListingPage
from pages.sim_service_page import SimServicePage


class TestSalesPortalOrder:
    def _reach_offer(self, listing: ProductListingPage) -> None:
        listing.navigate_5g_bb()
        listing.expect_list_refreshed("Broadband")
        listing.go_to_page(2)
        listing.expect_list_nonempty()
        listing.go_to_page(3)
        listing.select_offer_by_key()
        OrderApplicationPage(listing.page).next_step()

    @pytest.mark.smoke
    def test_tc100_full_order_application(self, logged_in_page: Page) -> None:
        page = logged_in_page
        self._reach_offer(ProductListingPage(page))

        order = OrderApplicationPage(page)
        kyc = KycPage(page)
        order.expand_field(2)
        kyc.fill_test_id()
        order.expand_field(2)
        kyc.upload_id_image()
        kyc.click_credit_check()
        kyc.select_identity_method(3)
        kyc.fill_contact_mobile()
        kyc.ensure_mobile_verified()

        address = AddressPage(page)
        address.fill_pre_street_fields()
        address.pick_autocomplete()
        address.fill_flat()
        address.pick_domicile_type(3)

        dismiss_shop_cart_drawer(page)
        payment = PaymentPage(page)
        payment.fill_card_number()
        payment.sign_card()
        payment.fill_name_on_card()
        payment.fill_expiration()
        payment.sign_inline()
        consent = page.locator(".flex-body canvas:visible").last
        if consent.count() > 0:
            box = consent.bounding_box()
            if box:
                consent.click(
                    position={"x": box["width"] * 0.6, "y": box["height"] * 0.35},
                    force=True,
                )
            else:
                consent.click(force=True)
        proceed_to_sim_step(page)

        sim = SimServicePage(page)
        sim.fill_sim_ids()
        sim.agree_terms()
        sim.sign_consent()
        sim.pick_agreement_type(3)

        dismiss_shop_cart_drawer(page)
        yes = page.locator(".flex-body").get_by_role("button", name="Yes")
        expect(yes.last).to_be_visible(timeout=30_000)
        yes.last.click(force=True)
        page.wait_for_load_state("networkidle")

        body = page.locator("body").inner_text()
        assert any(
            t.lower() in body.lower()
            for t in ("Submitted", "Success", "Application", "Thank you")
        ), "提交后未出现成功文案"
        error_alert = page.locator(
            ".p-message-error, .alert-danger, [role='alert']"
        ).filter(has_text=re.compile(r"error|fail|invalid", re.I))
        if error_alert.count() > 0:
            expect(error_alert.first).to_be_hidden(timeout=3_000)
