"""全站浮层/侧栏清理。"""
import re

from typing import Any

from playwright.sync_api import Page, expect

from data.kyc_factory import get_otp_stub


def dismiss_shop_cart_drawer(page: Page) -> None:
    for _ in range(4):
        drawer = page.locator(".h-shop-cart.p-sidebar-active, .p-sidebar-bottom.p-sidebar-active")
        if drawer.count() == 0 or not drawer.first.is_visible():
            return
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        close = drawer.locator(
            "[data-pc-section='closebutton'], .p-sidebar-close, .p-sidebar-header button"
        )
        if close.count() > 0:
            close.first.click(force=True)
            page.wait_for_timeout(200)


def _fill_otp_inputs(inputs: Any, code: str) -> None:
    count = inputs.count()
    if count >= len(code):
        for i, ch in enumerate(code):
            inputs.nth(i).fill(ch)
    elif count >= 1:
        inputs.first.fill(code)


def complete_otp_if_present(page: Page) -> None:
    code = get_otp_stub()
    dialog = page.get_by_role("dialog").filter(
        has_text=re.compile(r"One-time Password|verification code|OTP|verify", re.I)
    )
    if dialog.count() > 0 and dialog.first.is_visible():
        inputs = dialog.first.locator("input").filter(has_not=page.locator('[type="hidden"]'))
        _fill_otp_inputs(inputs, code)
        for label in ("Verify", "Confirm", "Submit", "OK", "Continue"):
            btn = dialog.first.get_by_role("button", name=re.compile(label, re.I))
            if btn.count() > 0:
                btn.first.click()
                break
        else:
            close = dialog.first.get_by_role("button", name=re.compile(r"Close", re.I))
            if close.count() > 0:
                close.first.click()
        page.wait_for_load_state("networkidle")
        try:
            expect(dialog.first).to_be_hidden(timeout=20_000)
        except AssertionError:
            page.keyboard.press("Escape")

    contact = page.get_by_role("region", name=re.compile(r"Contact Information", re.I))
    if contact.count() > 0:
        extra = contact.first.locator("input:visible").filter(
            has_not=page.locator('[type="hidden"]')
        )
        if extra.count() > 1:
            start = 1 if extra.count() >= 4 else 0
            for i, ch in enumerate(code):
                idx = start + i
                if idx < extra.count():
                    extra.nth(idx).fill(ch)
