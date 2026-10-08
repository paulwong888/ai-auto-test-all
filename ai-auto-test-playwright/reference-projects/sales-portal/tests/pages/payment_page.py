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
from pages.signature_dialog import (
    SignatureDialog,
    inline_signature_needs_stroke,
    sign_consent_signature,
)

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
        expect(self.signature_button).to_be_visible(timeout=15_000)
        self.signature_button.click()
        SignatureDialog(self.page, dialog_name="Credit Card Signature").sign()
        # SIT 签名完成后弹窗关闭即可；按钮可能仍可见供重签
        credit_dialog = self.page.get_by_role("dialog").filter(has_text=re.compile(r"Credit Card", re.I))
        if credit_dialog.count() > 0:
            expect(credit_dialog.first).to_be_hidden(timeout=15_000)

    def fill_name_on_card(self) -> None:
        expect(self.name_on_card).to_be_visible(timeout=15_000)
        self.name_on_card.fill(get_card_holder_name())

    def fill_expiration(self) -> None:
        expect(self.expiration).to_be_visible(timeout=15_000)
        self.expiration.fill(get_expiration_mmyy())

    def sign_inline(self) -> None:
        """页内条款 canvas 签名（Customer Consent / Please sign here）。"""
        resolve_deposit_cart_mismatch(self.page, BASE_URL)
        dismiss_shop_cart_drawer(self.page, BASE_URL)
        for attempt in range(2):
            sign_consent_signature(self.page)
            self.page.wait_for_load_state("domcontentloaded")
            if not inline_signature_needs_stroke(self.page):
                return
        raise AssertionError(
            "Customer Consent 签名后 Please sign here 仍为空，无法进入 SIM 步"
        )
