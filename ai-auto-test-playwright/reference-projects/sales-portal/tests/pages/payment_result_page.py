"""门户侧支付结果区 — Check Payment Status / Back to index。"""
import re

from playwright.sync_api import Page, expect

from pages.overlay_helpers import dismiss_shop_cart_drawer

CHECK_STATUS_RE = re.compile(r"Check Payment Status", re.I)
BACK_INDEX_RE = re.compile(r"Back to index", re.I)
WAITING_RE = re.compile(r"Please wait", re.I)
SUCCESS_RE = re.compile(r"收款成功|payment.*success|successful|Success", re.I)


class PaymentResultPage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def _wait_loading_gone(self, timeout_ms: int = 90_000) -> None:
        """Check Payment Status 后常有 Please wait!! / progressbar 阻塞。"""
        for _ in range(max(1, timeout_ms // 500)):
            dialog = self.page.get_by_role("dialog").filter(has_text=WAITING_RE)
            visible_wait = False
            if dialog.count() > 0:
                try:
                    visible_wait = dialog.first.is_visible()
                except Exception:
                    visible_wait = False
            prog = self.page.get_by_role("progressbar")
            visible_prog = False
            if prog.count() > 0:
                try:
                    visible_prog = prog.first.is_visible()
                except Exception:
                    visible_prog = False
            if not visible_wait and not visible_prog:
                return
            self.page.wait_for_timeout(500)
        raise AssertionError("Check Payment Status 后 Please wait 加载超时未结束")

    def _back_to_index_button(self):
        return self.page.get_by_role("button", name=BACK_INDEX_RE).first

    def check_payment_status(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        btn = self.page.get_by_role("button", name=CHECK_STATUS_RE).first
        expect(btn).to_be_visible(timeout=60_000)
        btn.click(force=True)
        self._wait_loading_gone()

        overlay = self.page.locator(".cdk-overlay-pane, .p-dialog").filter(
            has_text=re.compile(r"payment|success|收款|Payment", re.I)
        )
        if overlay.count() > 0:
            expect(overlay.first).to_be_visible(timeout=30_000)
            return

        if self.page.get_by_text(SUCCESS_RE).count() > 0:
            expect(self.page.get_by_text(SUCCESS_RE).first).to_be_visible(timeout=30_000)
            return

        expect(self._back_to_index_button()).to_be_visible(timeout=60_000)

    def close_status_overlay(self) -> None:
        for close in (
            self.page.get_by_role("button", name=re.compile(r"^(OK|Close|Confirm|確定|关闭)$", re.I)),
            self.page.locator(".p-dialog-header-close, .p-dialog-header-icon"),
        ):
            if close.count() > 0:
                try:
                    if close.first.is_visible():
                        close.first.click(force=True)
                        self.page.wait_for_timeout(400)
                        return
                except Exception:
                    continue
        backdrop = self.page.locator(".cdk-overlay-backdrop:visible")
        if backdrop.count() > 0:
            backdrop.first.click(force=True)
            self.page.wait_for_timeout(400)
            return
        self.page.keyboard.press("Escape")
        self.page.wait_for_timeout(300)

    def back_to_index(self) -> None:
        self._wait_loading_gone()
        btn = self._back_to_index_button()
        if btn.count() == 0 or not btn.is_visible():
            check = self.page.get_by_role("button", name=CHECK_STATUS_RE).first
            if check.count() > 0 and check.is_visible():
                check.click(force=True)
                self._wait_loading_gone()
        expect(self._back_to_index_button()).to_be_visible(timeout=60_000)
        self._back_to_index_button().click(force=True)
        self.page.wait_for_load_state("networkidle")
