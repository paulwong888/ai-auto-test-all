"""联系地址阶段 Page Object。"""
import re

from playwright.sync_api import Page, expect

from data.address_factory import get_autocomplete_suggestion, get_flat, get_street_text


class AddressPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.autocomplete = page.locator('input[name="undefined"]').first
        self.block = page.get_by_role("textbox", name="Block").first
        self.floor = page.get_by_role("textbox", name="Floor").first
        self.room = page.get_by_role("textbox", name="Room").first

    def fill_pre_street_fields(self) -> None:
        if self.page.get_by_role("textbox", name="Street/Estate").count() > 0:
            return
        textboxes = self.page.locator('input[type="text"]')
        for idx in (3, 4, 5):
            textboxes.nth(idx).fill("a")

    def pick_autocomplete(self) -> None:
        street = self.page.get_by_role("textbox", name="Street/Estate")
        if street.count() > 0:
            street.first.fill("ON SAU CT")
            self.page.get_by_role("textbox", name="Building").fill("ON CHUN HSE")
            return
        self.autocomplete.fill("1")
        suggestion = self.page.get_by_text(get_autocomplete_suggestion(), exact=False).first
        expect(suggestion).to_be_visible(timeout=15_000)
        suggestion.click()
        self.page.wait_for_load_state("networkidle")

    def fill_flat(self) -> None:
        flat = get_flat()
        expect(self.block).to_be_visible(timeout=15_000)
        self.block.fill(flat["block"])
        self.floor.fill(flat["floor"])
        self.room.fill(flat["room"])

    def pick_domicile_type(self, index: int = 3) -> None:
        radio = self.page.locator(
            "div:nth-child(9) > .form-group > .form-field > "
            "p-radiobutton:nth-child(%d) > .p-radiobutton" % index
        ).first
        if radio.count() > 0 and radio.is_visible():
            radio.click()
            return
        no_proof = self.page.get_by_role("radio", name=re.compile(r"No Address Proof", re.I))
        if no_proof.count() > 0:
            no_proof.first.check(force=True)
