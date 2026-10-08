"""KYC / 客户身份验证阶段 Page Object。"""
import re

from playwright.sync_api import Page, expect

from data.kyc_factory import get_mobile, get_test_hkid
from data.upload_factory import get_hkid_image
from pages.overlay_helpers import (
    KycOcrHkidRetry,
    complete_otp_if_present,
    dismiss_countdown_confirm_dialog,
    dismiss_privacy_policy_dialog,
)

_ID_ERROR_PATTERN = re.compile(r"fail|error|invalid|拒绝|失敗|失败", re.I)


class KycPage:
    def __init__(self, page: Page) -> None:
        self.page = page
        self.last_hkid: str | None = None
        self.test_id_input = page.get_by_role("textbox", name="Test ID number (override").first
        self.hkid_upload = page.locator("#hkIdUpload")
        self.credit_check_button = page.get_by_role("button", name="Credit Check").first
        self.contact_mobile = page.get_by_role("textbox", name="Contact Mobile").first
        self.verify_button = page.get_by_role("button", name="Verify").first

    def _personal_region(self):
        return self.page.get_by_role(
            "region", name=re.compile(r"Registration Personal Information", re.I)
        ).first

    def _expand_personal_information(self) -> None:
        """展开 Registration Personal Information，避免 i.nth(2) 折叠手风琴。"""
        btn = self.page.get_by_role(
            "button", name=re.compile(r"Registration Personal Information", re.I)
        )
        if btn.count() > 0:
            try:
                if btn.first.get_attribute("aria-expanded") == "false":
                    btn.first.click()
                    self.page.wait_for_timeout(400)
            except Exception:
                btn.first.click(force=True)
                self.page.wait_for_timeout(400)
            btn.first.scroll_into_view_if_needed()
            return
        icon = self.page.locator("i").nth(2)
        if icon.count() > 0:
            icon.click(force=True)
            self.page.wait_for_timeout(400)

    def _reveal_upload_control(self) -> None:
        """滚到 #hkIdUpload；录制第二次 i.nth(2) 为展开 upload 区。"""
        region = self._personal_region()
        upload = region.locator("#hkIdUpload") if region.count() > 0 else self.hkid_upload
        if upload.count() > 0:
            upload.first.evaluate(
                "el => el.scrollIntoView({block: 'center', inline: 'nearest'})"
            )
            self.page.wait_for_timeout(200)
            return
        icon = self.page.locator("i").nth(2)
        if icon.count() > 0:
            icon.click(force=True)
            self.page.wait_for_timeout(300)

    def _assert_image_uploaded(self) -> None:
        zoom = self.page.get_by_role("button", name="Zoom Image").first
        try:
            expect(zoom).to_be_visible(timeout=30_000)
            return
        except AssertionError:
            pass
        has_file = self.hkid_upload.evaluate(
            """el => !!(el.files && el.files.length > 0)"""
        )
        if has_file:
            return
        raise AssertionError(
            f"身份证图片未上传成功（Confirm 后 Zoom Image 仍不可见、#hkIdUpload 无文件）。"
            f" fixture={get_hkid_image()!r}"
        )

    def fill_test_id(self, value: str | None = None) -> None:
        expect(self.test_id_input).to_be_visible(timeout=15_000)
        self.last_hkid = value or get_test_hkid()
        self.test_id_input.fill(self.last_hkid)

    def _trigger_hkid_upload(self) -> None:
        """点击上传并选文件；SIT 选文件后马上弹出 Confirm 倒数框。"""
        image_path = get_hkid_image()
        expect(self.hkid_upload).to_be_attached(timeout=15_000)
        region = self._personal_region()
        upload_btn = region.get_by_role(
            "button", name=re.compile(r"Upload|Choose|Browse|上传|選擇|Browse Files", re.I)
        )
        if upload_btn.count() > 0 and upload_btn.first.is_visible():
            with self.page.expect_file_chooser(timeout=10_000) as fc_info:
                upload_btn.first.click()
            fc_info.value.set_files(image_path)
        else:
            self.hkid_upload.set_input_files(image_path)

    def upload_id_image(self) -> None:
        """选文件 → 立即 Confirm 倒数并点确认 → 再等上传成功。"""
        self._trigger_hkid_upload()
        dismiss_countdown_confirm_dialog(self.page)
        dismiss_privacy_policy_dialog(self.page)
        self.page.wait_for_load_state("networkidle")
        self._assert_image_uploaded()

    def fill_hkid_and_upload(self, value: str | None = None) -> None:
        """SIT：填 Test ID → 上传 → Confirm 倒数确认 → 等 OCR 姓名回填（Credit Check 另调）。"""
        self._expand_personal_information()
        self.fill_test_id(value)
        self._reveal_upload_control()
        self.upload_id_image()
        self._wait_upload_ocr_backfill()

    def click_credit_check(self) -> None:
        dismiss_countdown_confirm_dialog(self.page)
        dismiss_privacy_policy_dialog(self.page)
        expect(self.credit_check_button).to_be_visible(timeout=15_000)
        self.credit_check_button.click(force=True)
        self.page.wait_for_load_state("networkidle")
        dismiss_countdown_confirm_dialog(self.page)

    def _parse_hkid(self, hkid: str) -> tuple[str, str]:
        match = re.match(r"^(.+?)\((.+)\)$", hkid.strip())
        if match:
            return match.group(1), match.group(2)
        return hkid, ""

    def _assert_no_id_errors(self) -> None:
        for dialog in self.page.locator(".p-dialog:visible").all():
            text = dialog.inner_text()
            if _ID_ERROR_PATTERN.search(text):
                raise AssertionError(f"身份证/Credit Check 报错弹窗：{text[:200]}")
        alert = self.page.get_by_role("alert")
        if alert.count() > 0 and alert.first.is_visible():
            text = alert.first.inner_text()
            if _ID_ERROR_PATTERN.search(text):
                raise AssertionError(f"身份证/Credit Check 报错提示：{text[:200]}")

    def _ocr_snapshot(self) -> str:
        parts: list[str] = []
        for label in ("ID Number", "English Last Name", "English Name", "Chinese Name"):
            box = self.page.get_by_role("textbox", name=label).first
            try:
                parts.append(f"{label}={box.input_value()!r}")
            except Exception:
                parts.append(f"{label}=?")
        return "; ".join(parts)

    def _name_fields_populated(self) -> bool:
        """上传身份证后 SIT OCR 回填的中英文姓名。"""
        try:
            for label in ("English Last Name", "English Name", "Chinese Name"):
                box = self.page.get_by_role("textbox", name=label).first
                if not (box.input_value() or "").strip():
                    return False
            return True
        except Exception:
            return False

    def _wait_upload_ocr_backfill(self, timeout_sec: int = 60) -> None:
        """Confirm 已点后，等 OCR 回填姓名（Credit Check 之前必做）。"""
        self._assert_no_id_errors()
        for _ in range(timeout_sec):
            if self._name_fields_populated():
                return
            self.page.wait_for_timeout(1_000)
            self._assert_no_id_errors()
        raise KycOcrHkidRetry(
            f"Confirm 后 OCR 姓名未在 {timeout_sec}s 内回填（须先于 Credit Check）。"
            f" 当前：{self._ocr_snapshot()}"
        )

    def _ocr_ready(self, id_prefix: str, check_digit: str) -> bool:
        if not self._name_fields_populated():
            return False
        id_number = self.page.get_by_role("textbox", name="ID Number").first
        try:
            if id_prefix not in (id_number.input_value() or ""):
                return False
            if check_digit:
                personal = self._personal_region()
                for box in personal.get_by_role("textbox").all():
                    try:
                        val = box.input_value()
                    except Exception:
                        continue
                    if val == check_digit:
                        return True
                return False
            return True
        except Exception:
            return False

    def ensure_id_verified(self) -> None:
        """OCR 姓名已回填后点 Credit Check（须先 fill_hkid_and_upload）。"""
        hkid = self.last_hkid or get_test_hkid()
        id_prefix, check_digit = self._parse_hkid(hkid)

        self._assert_image_uploaded()
        if not self._name_fields_populated():
            self._wait_upload_ocr_backfill()

        self.click_credit_check()

        self._assert_no_id_errors()
        if not self._ocr_ready(id_prefix, check_digit):
            raise KycOcrHkidRetry(
                "Credit Check 后 KYC 字段未满足。"
                f" 期望 ID 含 {id_prefix!r}"
                f"{f'、校验位 {check_digit!r}' if check_digit else ''}、中英文姓名非空。"
                f" 当前：{self._ocr_snapshot()}"
            )

    def _expand_contact_information(self) -> None:
        contact_hdr = self.page.get_by_role("button", name=re.compile(r"Contact Information", re.I))
        if contact_hdr.count() > 0 and contact_hdr.first.get_attribute("aria-expanded") == "false":
            contact_hdr.first.click()
            self.page.wait_for_timeout(300)

    def select_identity_method(self, index: int = 3) -> None:
        """录制 index=3：Contact Information 区 Email 选 No（PrimeNG hidden radio）。"""
        self._expand_contact_information()
        region = self.page.get_by_role("region", name=re.compile(r"Contact Information", re.I))
        if region.count() > 0:
            no_radio = region.first.get_by_role("radio", name="No")
            if no_radio.count() > 0 and no_radio.first.is_checked():
                return
            box = region.first.locator(".p-radiobutton").filter(
                has_text=re.compile(r"^No$")
            ).locator(".p-radiobutton-box")
            if box.count() > 0:
                expect(box.first).to_be_attached(timeout=15_000)
                box.first.click(force=True)
                expect(no_radio.first).to_be_checked(timeout=5_000)
                return
        recorded = self.page.locator(
            "p-radiobutton:nth-child(%d) > .p-radiobutton > .p-radiobutton-box" % index
        )
        expect(recorded.first).to_be_attached(timeout=15_000)
        recorded.first.click(force=True)

    def fill_contact_mobile(self, value: str | None = None) -> None:
        self._expand_contact_information()
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
                    btn.first.click(force=True)
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

    def ensure_mobile_verified(self) -> None:
        """Verify 后必须离开「Please verify the mobile」提示，否则后续无法进入 SIM/Yes。"""
        self.click_verify()
        hint = self.page.get_by_text("Please verify the mobile", exact=False)
        expect(hint.first).to_be_hidden(timeout=30_000)
