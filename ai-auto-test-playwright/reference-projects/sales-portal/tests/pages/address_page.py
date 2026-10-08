"""Billing Address（5G BB SIT）+ 录制 fallback（sales-portal-order.py L28-40）。"""
import re

from playwright.sync_api import Locator, Page, expect

from data.address_factory import get_autocomplete_suggestion, get_flat, get_street_text

BILLING_SECTION_RE = re.compile(r"Billing Address", re.I)


class AddressPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def _billing_region(self) -> Locator:
        return self.page.get_by_role("region", name=BILLING_SECTION_RE).first

    def _has_billing_street_ui(self) -> bool:
        region = self.page.get_by_role("region", name=BILLING_SECTION_RE)
        if region.count() == 0:
            return False
        return region.first.get_by_role("textbox", name="Street/Estate").count() > 0

    def _expand_billing_accordion(self) -> None:
        btn = self.page.get_by_role("button", name=BILLING_SECTION_RE)
        if btn.count() > 0:
            try:
                if btn.first.get_attribute("aria-expanded") == "false":
                    btn.first.click()
                    self.page.wait_for_timeout(400)
            except Exception:
                btn.first.click(force=True)
                self.page.wait_for_timeout(400)
        self._billing_region().scroll_into_view_if_needed()

    def _pick_address_suggestion(self, root: Locator) -> None:
        """录制：点联想项；SIT 文案可能与 0929 略有差异。"""
        suggestion = get_autocomplete_suggestion()
        candidates = (
            suggestion,
            "1A YEN CHOW STREET",
            "YEN CHOW STREET",
            "12 ON YU ROAD",
        )
        for text in candidates:
            loc = self.page.get_by_text(text, exact=False)
            if loc.count() == 0:
                loc = root.get_by_text(text, exact=False)
            if loc.count() > 0:
                try:
                    loc.first.click(timeout=3_000)
                    self.page.wait_for_load_state("networkidle")
                    return
                except Exception:
                    continue
        opts = self.page.get_by_role("option").filter(
            has_text=re.compile(r"YEN CHOW|ON YU ROAD", re.I)
        )
        if opts.count() > 0:
            opts.first.click()
            self.page.wait_for_load_state("networkidle")

    def fill_billing_address_recorded(self) -> None:
        """Billing Address — SIT 新 UI（region 内 Street/Estate）或录制 nth 路径。"""
        self._expand_billing_accordion()
        root = self._billing_region()
        flat = get_flat()

        if self._has_billing_street_ui():
            search = root.locator("p-autocomplete input, .p-autocomplete input").first
            if search.count() > 0:
                search.click()
                search.fill(get_street_text())
                self.page.wait_for_timeout(600)
                self._pick_address_suggestion(root)

            street = root.get_by_role("textbox", name="Street/Estate")
            if street.count() > 0 and not (street.input_value() or "").strip():
                street.fill("YEN CHOW ST")
            building = root.get_by_role("textbox", name="Building")
            if building.count() > 0:
                building.fill("BLOCK A")

            kowloon = root.get_by_role("combobox", name=re.compile(r"Kowloon", re.I))
            if kowloon.count() > 0 and kowloon.first.is_visible():
                kowloon.first.click()
                self.page.wait_for_timeout(300)
                opt = self.page.get_by_role("option", name=re.compile(r"Kowloon", re.I))
                if opt.count() > 0:
                    opt.first.click()

            for label, key in (("Block", "block"), ("Floor", "floor"), ("Room", "room")):
                box = root.get_by_role("textbox", name=label)
                expect(box.first).to_be_visible(timeout=10_000)
                box.first.click()
                box.first.fill(flat[key])
            return

        self._fill_address_legacy_nth(field_set_index=0)

    def _fill_address_legacy_nth(self, field_set_index: int = 0) -> None:
        """录制 sales-portal-order.py L28-38（旧版 undefined 联想）。"""
        flat = get_flat()
        textboxes = self.page.locator('input[type="text"]')
        for base in (3, 4, 5):
            idx = base + field_set_index * 3
            if idx < textboxes.count():
                textboxes.nth(idx).fill("a")

        undefined = self.page.locator('input[name="undefined"]')
        if undefined.count() > field_set_index:
            undefined.nth(field_set_index).click()
            undefined.nth(field_set_index).fill("1")
        elif undefined.count() > 0:
            undefined.first.click()
            undefined.first.fill("1")

        self._pick_address_suggestion(self.page.locator("body"))

        for label, key in (("Block", "block"), ("Floor", "floor"), ("Room", "room")):
            fields = self.page.get_by_role("textbox", name=label)
            idx = field_set_index if fields.count() > field_set_index else 0
            fields.nth(idx).click()
            fields.nth(idx).fill(flat[key])

    def fill_contact_address_recorded(self) -> None:
        """旧版联系地址区（若存在则填；5G BB 现多为仅 Billing）。"""
        if self._has_billing_street_ui():
            return
        self._fill_address_legacy_nth(field_set_index=0)

    def fill_all(self) -> None:
        """5G BB：Billing Address + No Address Proof（录制 0929 数据）。"""
        self.fill_billing_address_recorded()
        self.pick_no_address_proof()

    def fill_pre_street_fields(self) -> None:
        if self._has_billing_street_ui():
            search = self._billing_region().locator("p-autocomplete input").first
            if search.count() > 0:
                search.fill(get_street_text())
            return
        textboxes = self.page.locator('input[type="text"]')
        for idx in (3, 4, 5):
            if idx < textboxes.count():
                textboxes.nth(idx).fill("a")

    def pick_autocomplete(self) -> None:
        root = self._billing_region() if self._has_billing_street_ui() else self.page.locator("body")
        self._pick_address_suggestion(root)

    def fill_flat(self) -> None:
        flat = get_flat()
        root = self._billing_region() if self._has_billing_street_ui() else self.page.locator("body")
        for label, key in (("Block", "block"), ("Floor", "floor"), ("Room", "room")):
            box = root.get_by_role("textbox", name=label).first
            box.click()
            box.fill(flat[key])

    def _no_address_proof_hidden(self, root: Locator) -> Locator:
        return root.locator("#NoAddressProof")

    def _no_address_proof_visible_box(self, root: Locator) -> Locator:
        """PrimeNG 真实可点的是 .p-radiobutton-box；hidden input 在视口外。"""
        return self._no_address_proof_hidden(root).locator(
            "xpath=ancestor::*[contains(@class,'p-radiobutton')][1]"
        ).locator(".p-radiobutton-box")

    def pick_no_address_proof(self) -> None:
        """Billing 区内选 No Address Proof（录制 L40 / 0929 plan）。"""
        self._expand_billing_accordion()
        root = self._billing_region()
        no_proof_re = re.compile(r"^No Address Proof$", re.I)
        hidden = self._no_address_proof_hidden(root) if root.count() > 0 else self.page.locator("#NoAddressProof")

        if hidden.count() > 0 and hidden.first.is_checked():
            return

        def _try_click_box(box: Locator) -> None:
            box.first.evaluate("el => el.scrollIntoView({block: 'center', inline: 'nearest'})")
            self.page.wait_for_timeout(250)
            box.first.click(force=True)

        if root.count() > 0:
            box = self._no_address_proof_visible_box(root)
            if box.count() > 0:
                _try_click_box(box)
                if hidden.count() > 0 and hidden.first.is_checked():
                    return

            label = root.get_by_text(no_proof_re)
            if label.count() > 0:
                _try_click_box(label)

        recorded = self.page.locator(
            "div:nth-child(9) > .form-group > .form-field > "
            "p-radiobutton:nth-child(3) > .p-radiobutton > .p-radiobutton-box"
        )
        if recorded.count() > 0:
            _try_click_box(recorded)

        if hidden.count() == 0:
            hidden = self.page.locator("#NoAddressProof")
        expect(hidden.first).to_be_checked(timeout=5_000)

    def pick_domicile_type(self, index: int = 3) -> None:
        self.pick_no_address_proof()
