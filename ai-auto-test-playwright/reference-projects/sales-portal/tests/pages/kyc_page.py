"""KYC / 客户身份验证阶段 Page Object。"""
from playwright.sync_api import Page, expect

from data.kyc_factory import get_mobile, get_test_hkid
from data.upload_factory import get_hkid_image
from pages.overlay_helpers import complete_otp_if_present


class KycPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.test_id_input = page.get_by_role("textbox", name="Test ID number (override").first
        self.hkid_upload = page.locator("#hkIdUpload")
        self.credit_check_button = page.get_by_role("button", name="Credit Check").first
        self.contact_mobile = page.get_by_role("textbox", name="Contact Mobile").first
        self.verify_button = page.get_by_role("button", name="Verify").first

    def fill_test_id(self, value: str | None = None) -> None:
        expect(self.test_id_input).to_be_visible(timeout=15_000)
        self.test_id_input.fill(value or get_test_hkid())

    def upload_id_image(self) -> None:
        expect(self.hkid_upload).to_be_attached(timeout=15_000)
        self.hkid_upload.set_input_files(get_hkid_image())

    def click_credit_check(self) -> None:
        expect(self.credit_check_button).to_be_visible(timeout=15_000)
        self.credit_check_button.click()
        self.page.wait_for_load_state("networkidle")

    def select_identity_method(self, index: int = 3) -> None:
        radio = self.page.locator(
            "p-radiobutton:nth-child(%d) > .p-radiobutton > .p-radiobutton-box" % index
        ).first
        expect(radio).to_be_visible(timeout=15_000)
        radio.click()

    def fill_contact_mobile(self, value: str | None = None) -> None:
        expect(self.contact_mobile).to_be_visible(timeout=15_000)
        self.contact_mobile.fill(value or get_mobile())

    def dismiss_open_dialogs(self) -> None:
        mask = self.page.locator(".p-dialog-mask")
        if mask.count() == 0 or not mask.first.is_visible():
            return
        complete_otp_if_present(self.page)
        if mask.count() > 0 and mask.first.is_visible():
            dialog = self.page.locator(".p-dialog")
            for name in ("Close", "OK", "Ok"):
                btn = dialog.get_by_role("button", name=name)
                if btn.count() > 0:
                    btn.first.click()
                    break
            expect(mask.first).to_be_hidden(timeout=30_000)

    def click_verify(self) -> None:
        expect(self.verify_button).to_be_visible(timeout=15_000)
        self.verify_button.click()
        self.page.wait_for_load_state("networkidle")
        complete_otp_if_present(self.page)
        self.dismiss_open_dialogs()
        hint = self.page.get_by_text("Please verify the mobile", exact=False)
        if hint.count() > 0 and hint.first.is_visible():
            complete_otp_if_present(self.page)
            self.verify_button.click()
            self.page.wait_for_load_state("networkidle")
            complete_otp_if_present(self.page)
            expect(hint.first).to_be_hidden(timeout=30_000)

    def ensure_mobile_verified(self) -> None:
        """Verify 后必须离开「Please verify the mobile」提示，否则后续无法进入 SIM/Yes。"""
        self.click_verify()
        hint = self.page.get_by_text("Please verify the mobile", exact=False)
        if hint.count() > 0:
            expect(hint.first).to_be_hidden(timeout=30_000)
