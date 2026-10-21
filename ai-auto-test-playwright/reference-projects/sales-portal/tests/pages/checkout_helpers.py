"""从申请长表单进入 SIM / 结账步。"""
import re
import time

from playwright.sync_api import Page, expect

from conftest import BASE_URL
from pages.overlay_helpers import (
    click_cart_footer_next_chevron,
    complete_otp_if_present,
    dismiss_shop_cart_drawer,
    is_sim_only_order,
    resolve_deposit_cart_mismatch,
)
from pages.order_application_page import OrderApplicationPage
from pages.signature_dialog import (
    _please_sign_here_present,
    consent_signature_valid,
    expand_consent_signature_section,
    inline_signature_needs_stroke,
    sign_consent_signature,
)

SIM_STEP_BODY_RE = re.compile(r"PRIMARY\s+SIM|SIM\s*&\s*Device|Handset\s+IMEI", re.I)
SIM_STEP_TEXT_RE = re.compile(r"PRIMARY\s+SIM|SIM\s*&\s*Device", re.I)
SIGN_HERE_RE = re.compile(r"Please sign here", re.I)

_LOADING_OVERLAY_SELECTORS = (
    ".p-progress-spinner:visible",
    ".p-blockui:visible",
    ".p-blockui-document:visible",
    ".flex-body .pi-spinner:visible",
    ".p-datatable-loading-overlay:visible",
    "app-crm-loading:visible",
)


def _portal_loading_visible(page: Page) -> bool:
    for sel in _LOADING_OVERLAY_SELECTORS:
        if page.locator(sel).count() > 0:
            return True
    return False


def _wait_sim_step_after_chevron(page: Page, timeout_ms: int = 90_000) -> bool:
    """点 ``>`` 后 Portal 常转圈并卸载 Consent 区；等到 SIM 可见或 idle。"""
    stable = 0
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if _sim_visible(page):
            return True
        if _portal_loading_visible(page):
            stable = 0
            page.wait_for_timeout(400)
            continue
        stable += 1
        if stable >= 2:
            break
        page.wait_for_timeout(300)
    return _sim_visible(page)


def _sign_consent_if_still_on_kyc_form(page: Page) -> None:
    """仅在 KYC 表单仍展示 Consent 时签名；转场/转圈时不重复签。"""
    if consent_signature_valid(page):
        return
    if _portal_loading_visible(page):
        if _wait_sim_step_after_chevron(page):
            return
    expand_consent_signature_section(page)
    if consent_signature_valid(page):
        return
    if not _please_sign_here_present(page):
        if _wait_sim_step_after_chevron(page):
            return
        if not _please_sign_here_present(page):
            return
    if consent_signature_valid(page):
        return
    sign_consent_signature(page)


def _sim_visible(page: Page) -> bool:
    body = page.locator("body").inner_text()
    if SIM_STEP_BODY_RE.search(body):
        return True
    if re.search(r"Handset\s+IMEI", body, re.I):
        return True
    if page.get_by_role("textbox", name=re.compile(r"Test ID number", re.I)).count() > 0:
        return False
    if page.get_by_role("checkbox", name=re.compile(r"agree|read", re.I)).count() > 0:
        if re.search(r"Test ID|Credit Check|Payment Method", body, re.I):
            return False
        return True
    return page.get_by_role("checkbox", name="I have read and agree to the").count() > 0


def _reverify_mobile_if_hint_visible(page: Page) -> None:
    """申请表单 → SIM 步的前置条件：手机号必须已验证（Sim Only SIT 填号即可，不 Verify）。"""
    hint = page.get_by_text("Please verify the mobile", exact=False)
    if hint.count() == 0 or not hint.first.is_visible():
        return
    from pages.kyc_page import KycPage

    kyc = KycPage(page)
    if is_sim_only_order(page):
        kyc.fill_contact_mobile()
        if hint.count() == 0 or not hint.first.is_visible():
            return
        raise AssertionError(
            "Sim Only 仍显示 Please verify the mobile，但 SIT 不要求 Verify。"
            " 请确认 Contact Mobile 已填 62304545 或检查 SIT 规则变更。"
        )
    kyc.ensure_mobile_verified()
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
    if not inline_signature_needs_stroke(page):
        return
    expand_consent_signature_section(page)
    sign_consent_signature(page)


def _fortress_pos_active() -> bool:
    from data.account_factory import POS_ACCOUNT_FORTRESS, get_pos_account

    return get_pos_account().upper() == POS_ACCOUNT_FORTRESS.upper()


def _reverify_fortress_shop_if_needed(page: Page) -> None:
    if not _fortress_pos_active():
        return
    from pages.fortress_shop_page import FortressShopPage

    FortressShopPage(page).fill_and_verify_shop_id()


def _sim_step_blockers(page: Page) -> list[str]:
    blockers: list[str] = []
    from pages.kyc_page import KycPage

    kyc = KycPage(page)
    if kyc._credit_check_actionable():
        blockers.append("Credit Check 按钮仍可点击（征信可能未完成）")
    verify = page.get_by_text("Please verify the mobile", exact=False)
    if verify.count() > 0 and verify.first.is_visible():
        blockers.append("Please verify the mobile 仍可见")
    if _please_sign_here_present(page) and not consent_signature_valid(page):
        blockers.append("Customer Consent / Please sign here 签名无效或为空")
    return blockers


def _raise_sim_step_blocked(page: Page, body: str) -> None:
    blockers = _sim_step_blockers(page)
    detail = "；".join(blockers) if blockers else "见页面尾部"
    raise AssertionError(
        "未能进入 SIM 步，页面仍停留在申请长表单。"
        f" 阻塞项：{detail}。"
        " 常见原因：Credit Check 未完成、手机号未验证、条款签名未完成。"
        f" 页面尾部文本：{body[-300:]}"
    )


def _click_progress_chevron(page: Page) -> None:
    if click_cart_footer_next_chevron(page):
        if _sim_visible(page):
            return
    for _ in range(3):
        chev = page.locator(".flex-body .pi.pi-chevron-right:visible").first
        if chev.count() == 0:
            break
        chev.scroll_into_view_if_needed()
        chev.click(force=True)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(200)
        if _sim_visible(page):
            return


def proceed_to_sim_step(page: Page) -> None:
    """录制：付款后一次 chevron；若仍无 SIM 文案则尝试打开底部购物车侧栏内的继续/结账。"""
    if _sim_visible(page):
        return
    if _portal_loading_visible(page):
        if _wait_sim_step_after_chevron(page):
            return
    expand_consent_signature_section(page)
    if consent_signature_valid(page):
        _dismiss_blocking_overlays(page)
        if not _portal_loading_visible(page):
            _click_progress_chevron(page)
        if _sim_visible(page):
            return
        if _portal_loading_visible(page) and _wait_sim_step_after_chevron(page):
            return
    from pages.kyc_page import KycPage

    if not _sim_visible(page):
        OrderApplicationPage(page).fill_second_agent_if_required()
    if _sim_visible(page):
        return
    KycPage(page).ensure_credit_check_done()
    _reverify_fortress_shop_if_needed(page)
    _reverify_mobile_if_hint_visible(page)
    resolve_deposit_cart_mismatch(page, BASE_URL)
    expand_consent_signature_section(page)
    _sign_consent_if_still_on_kyc_form(page)
    if _sim_visible(page):
        return
    for _ in range(4):
        if _sim_visible(page):
            return
        if _portal_loading_visible(page):
            if _wait_sim_step_after_chevron(page):
                return
        if inline_signature_needs_stroke(page):
            expand_consent_signature_section(page)
            _sign_consent_if_still_on_kyc_form(page)
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
        page.wait_for_timeout(200)
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
    if SIGN_HERE_RE.search(body):
        expand_consent_signature_section(page)
        _sign_consent_if_still_on_kyc_form(page)
        _dismiss_blocking_overlays(page)
        _click_progress_chevron(page)
        if _sim_visible(page):
            return
        body = page.locator("body").inner_text()
    _raise_sim_step_blocked(page, body)
