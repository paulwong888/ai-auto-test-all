"""信用卡付款阶段 Page Object。"""
from playwright.sync_api import Page, expect

from data.credit_card_factory import (
    get_card_holder_name,
    get_credit_card_segments,
    get_expiration_mmyy,
)
from pages.overlay_helpers import dismiss_shop_cart_drawer
from pages.signature_dialog import SignatureDialog

CARD_INPUT_CSS = ".p-inputtext.p-component.p-element.form-control.credit-card-input-width"


class PaymentPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.signature_button = page.get_by_role("button", name="Credit Card Signature").first
        self.name_on_card = page.get_by_role("textbox", name="Name On Card").first
        self.expiration = page.get_by_role("textbox", name="Expiration date (MMYY)").first

    def fill_card_number(self) -> None:
        dismiss_shop_cart_drawer(self.page)
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
        dismiss_shop_cart_drawer(self.page)
        from pages.overlay_helpers import complete_otp_if_present

        complete_otp_if_present(self.page)
        expect(self.signature_button).to_be_visible(timeout=15_000)
        self.signature_button.click()
        dialog = self.page.get_by_role("dialog").filter(has_text="Credit Card")
        SignatureDialog(self.page, dialog_name="Credit Card Signature").sign()
        expect(self.signature_button).to_be_hidden(timeout=15_000)

    def fill_name_on_card(self) -> None:
        expect(self.name_on_card).to_be_visible(timeout=15_000)
        self.name_on_card.fill(get_card_holder_name())

    def fill_expiration(self) -> None:
        expect(self.expiration).to_be_visible(timeout=15_000)
        self.expiration.fill(get_expiration_mmyy())

    def sign_inline(self) -> None:
        canvas = self.page.locator("canvas:visible").first
        if canvas.count() == 0:
            return
        box = canvas.bounding_box()
        if box:
            canvas.click(position={"x": box["width"] * 0.6, "y": box["height"] * 0.35})
        else:
            canvas.click()
