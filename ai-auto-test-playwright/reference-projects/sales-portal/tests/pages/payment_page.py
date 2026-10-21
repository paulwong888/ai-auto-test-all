"""信用卡付款阶段 Page Object。"""
import re

from playwright.sync_api import Page, expect

from data.credit_card_factory import (
    get_card_holder_name,
    get_credit_card_segments,
    get_expiration_mmyy,
)
from conftest import BASE_URL
from pages.overlay_helpers import dismiss_shop_cart_drawer, resolve_deposit_cart_mismatch
from pages.signature_dialog import SignatureDialog, sign_consent_signature

CARD_INPUT_CSS = ".p-inputtext.p-component.p-element.form-control.credit-card-input-width"


class PaymentPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.signature_button = page.get_by_role("button", name="Credit Card Signature").first
        self.name_on_card = page.get_by_role("textbox", name="Name On Card").first
        self.expiration = page.get_by_role("textbox", name="Expiration date (MMYY)").first

    def fill_card_number(self) -> None:
        resolve_deposit_cart_mismatch(self.page, BASE_URL)
        dismiss_shop_cart_drawer(self.page, BASE_URL)
        cards = self.page.locator(CARD_INPUT_CSS)
        if cards.count() >= 3:
            expect(cards.first).to_be_visible(timeout=15_000)
            segments = get_credit_card_segments()
            for i, seg in enumerate(segments[:4]):
                if i < cards.count():
                    cards.nth(i).fill(seg)
            return
        pay = self.page.get_by_role("button", name="Payment Method")
        if pay.count() > 0 and pay.first.get_attribute("aria-expanded") == "false":
            pay.first.click()
        region = self.page.get_by_role("region", name="Payment Method")
        inputs = region.locator("input.p-inputtext") if region.count() else self.page.locator("input.p-inputtext")
        segments = get_credit_card_segments()
        for i, seg in enumerate(segments[:4]):
            if i < inputs.count():
                inputs.nth(i).fill(seg)

    def sign_card(self) -> None:
        dismiss_shop_cart_drawer(self.page, BASE_URL)
        from pages.overlay_helpers import complete_otp_if_present

        complete_otp_if_present(self.page)
        if self.signature_button.count() == 0:
            return
        try:
            expect(self.signature_button).to_be_visible(timeout=5_000)
        except AssertionError:
            # Sim Only 等流程可能无弹窗式 Credit Card Signature，仅页内 Consent 签名
            return
        self.signature_button.click()
        SignatureDialog(self.page, dialog_name="Credit Card Signature").sign()
        # SIT 签名完成后弹窗关闭即可；按钮可能仍可见供重签
        credit_dialog = self.page.get_by_role("dialog").filter(has_text=re.compile(r"Credit Card", re.I))
        if credit_dialog.count() > 0:
            expect(credit_dialog.first).to_be_hidden(timeout=8_000)

    def fill_name_on_card(self) -> None:
        expect(self.name_on_card).to_be_visible(timeout=15_000)
        self.name_on_card.fill(get_card_holder_name())

    def fill_expiration(self) -> None:
        expect(self.expiration).to_be_visible(timeout=15_000)
        self.expiration.fill(get_expiration_mmyy())

    def sign_inline(self) -> None:
        """页内条款 canvas 签名（Customer Consent / Please sign here）。"""
        from pages.signature_dialog import consent_signature_valid, expand_consent_signature_section

        resolve_deposit_cart_mismatch(self.page, BASE_URL)
        dismiss_shop_cart_drawer(self.page, BASE_URL)
        expand_consent_signature_section(self.page)
        if consent_signature_valid(self.page):
            return
        for _ in range(3):
            sign_consent_signature(self.page)
            expand_consent_signature_section(self.page)
            self.page.wait_for_timeout(200)
            if consent_signature_valid(self.page):
                return
        raise AssertionError(
            "Customer Consent 签名后 Please sign here 仍为空，无法进入 SIM 步"
        )

    def advance_after_payment_signature(self) -> None:
        """Customer Consent 签名完成后立即点底部 ``>``  toward SIM。"""
        self.sign_inline()
        from pages.checkout_helpers import _click_progress_chevron, _sim_visible

        if _sim_visible(self.page):
            return
        dismiss_shop_cart_drawer(self.page, BASE_URL)
        _click_progress_chevron(self.page)
        from pages.checkout_helpers import _portal_loading_visible, _wait_sim_step_after_chevron

        if _portal_loading_visible(self.page):
            _wait_sim_step_after_chevron(self.page)
