"""从申请长表单进入 SIM / 结账步。"""
import re

from playwright.sync_api import Page, expect

from conftest import BASE_URL
from pages.overlay_helpers import (
    complete_otp_if_present,
    dismiss_shop_cart_drawer,
    resolve_deposit_cart_mismatch,
)
from pages.signature_dialog import inline_signature_needs_stroke, sign_consent_signature

SIM_STEP_BODY_RE = re.compile(r"PRIMARY\s+SIM|SIM\s*&\s*Device|Handset\s+IMEI", re.I)
SIM_STEP_TEXT_RE = re.compile(r"PRIMARY\s+SIM|SIM\s*&\s*Device", re.I)
SIGN_HERE_RE = re.compile(r"Please sign here", re.I)


def _sim_visible(page: Page) -> bool:
    body = page.locator("body").inner_text()
    if SIM_STEP_BODY_RE.search(body):
        return True
    if page.get_by_role("checkbox", name=re.compile(r"agree|read", re.I)).count() > 0:
        return True
    return page.get_by_role("checkbox", name="I have read and agree to the").count() > 0


def _reverify_mobile_if_hint_visible(page: Page) -> None:
    """申请表单 → SIM 步的前置条件：手机号必须已验证。"""
    hint = page.get_by_text("Please verify the mobile", exact=False)
    if hint.count() == 0 or not hint.first.is_visible():
        return
    verify = page.get_by_role("button", name="Verify").first
    if verify.count() > 0 and verify.is_visible():
        verify.click()
        page.wait_for_load_state("networkidle")
        complete_otp_if_present(page)
    expect(hint.first).to_be_hidden(timeout=30_000)


def _dismiss_blocking_overlays(page: Page) -> None:
    """关闭 OTP/弹窗 mask，避免 chevron 被 p-dialog-mask 拦截。"""
    complete_otp_if_present(page)
    dismiss_shop_cart_drawer(page, BASE_URL)
    for _ in range(3):
        mask = page.locator(".p-dialog-mask:visible")
        if mask.count() == 0:
            break
        dialog = page.get_by_role("dialog").filter(has_text=re.compile(r".+", re.I))
        if dialog.count() > 0 and dialog.first.is_visible():
            for label in ("Confirm", "OK", "Close", "Verify"):
                btn = dialog.first.get_by_role("button", name=re.compile(label, re.I))
                if btn.count() > 0 and btn.first.is_visible():
                    btn.first.click(force=True)
                    page.wait_for_load_state("networkidle")
                    break
            else:
                page.keyboard.press("Escape")
        else:
            page.keyboard.press("Escape")
        page.wait_for_timeout(300)


def _ensure_inline_signature_if_needed(page: Page) -> None:
    """若条款区 canvas 仍空白，补画页内签名。"""
    if inline_signature_needs_stroke(page):
        sign_consent_signature(page)


def _click_progress_chevron(page: Page) -> None:
    for _ in range(3):
        chev = page.locator(".flex-body .pi.pi-chevron-right:visible").first
        if chev.count() == 0:
            break
        chev.scroll_into_view_if_needed()
        chev.click(force=True)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
        if _sim_visible(page):
            return


def proceed_to_sim_step(page: Page) -> None:
    """录制：付款后一次 chevron；若仍无 SIM 文案则尝试打开底部购物车侧栏内的继续/结账。"""
    if _sim_visible(page):
        return
    _reverify_mobile_if_hint_visible(page)
    resolve_deposit_cart_mismatch(page, BASE_URL)
    for _ in range(4):
        if _sim_visible(page):
            return
        if inline_signature_needs_stroke(page):
            sign_consent_signature(page)
        _dismiss_blocking_overlays(page)
        _click_progress_chevron(page)
        if _sim_visible(page):
            return
    _ensure_inline_signature_if_needed(page)
    _dismiss_blocking_overlays(page)
    _click_progress_chevron(page)
    if _sim_visible(page):
        return
    alt = page.locator(".pi.pi-chevron-right:visible").filter(
        has_not=page.locator(".p-sidebar, .h-shop-cart")
    ).first
    if alt.count() > 0:
        alt.scroll_into_view_if_needed()
        alt.click(force=True)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
    if _sim_visible(page):
        return
    # 底部金额条打开购物车（SIT 部分版本 SIM 在侧栏/checkout）
    footer = page.locator(".flex-body").get_by_text(re.compile(r"\$\s*\d")).last
    if footer.count() > 0:
        footer.click()
        page.wait_for_timeout(600)
    drawer = page.locator(".h-shop-cart.p-sidebar-active, .p-sidebar-active")
    if drawer.count() > 0 and drawer.first.is_visible():
        for label in ("Checkout", "Continue", "Next", "Proceed", "Confirm"):
            btn = drawer.first.get_by_role("button", name=re.compile(label, re.I))
            if btn.count() > 0:
                btn.first.click()
                page.wait_for_load_state("networkidle")
                break
    sim_marker = page.get_by_text(SIM_STEP_TEXT_RE)
    if sim_marker.count() > 0:
        expect(sim_marker.first).to_be_visible(timeout=30_000)
        return
    if _sim_visible(page):
        return
    body = page.locator("body").inner_text()
    raise AssertionError(
        "未能进入 SIM 步，页面仍停留在申请长表单。常见原因：手机号未完成"
        "验证（Please verify the mobile 提示仍在）、条款签名未完成（Please sign here）"
        "或表单存在未满足的必填/风控校验。页面尾部文本：" + body[-300:]
    )
