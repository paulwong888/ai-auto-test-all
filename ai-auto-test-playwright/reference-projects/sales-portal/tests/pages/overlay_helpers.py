"""全站浮层/侧栏清理。"""
import re

from typing import Any

from playwright.sync_api import Page, expect


class DepositCartHkidRetry(Exception):
    """购物车 deposit 与后台不一致，需换 HKID 并重跑选套餐/KYC。"""


class KycOcrHkidRetry(Exception):
    """Credit Check / OCR 未回填，需换 HKID 并重跑选套餐/KYC。"""

from data.kyc_factory import get_otp_stub

PENDING_PAYMENT_RE = re.compile(r"Waiting for payment done", re.I)
CHECK_PAYMENT_RE = re.compile(r"Check Payment Status", re.I)
DRAFT_APPLICATION_RE = re.compile(
    r"Waiting for payment done|Payment Method|PRIMARY SIM|Registration Personal Information|Select Activation Date",
    re.I,
)
BB_LISTING_PRICE_RE = re.compile(r"\$168")
DEPOSIT_CART_RE = re.compile(
    r"a deposit of .+ is required|check the cart amount for changes",
    re.I | re.S,
)
# 5G BB 正常 upfront/押金通常远小于 5 万；785040 等为多次脏草稿叠加
MAX_SANE_CART_AMOUNT = 50_000


def _in_offer_configuration(page: Page) -> bool:
    """套餐配置向导（非 browse 列表；列表页也会出现 Thereafter Local Services 文案）。"""
    body = page.locator("body").inner_text()
    return bool(re.search(r"Add On Sim|Update Customer Own CPE IMEI", body, re.I))


def _featured_plans_visible(page: Page) -> bool:
    plans = page.get_by_text("Featured Monthly Plans", exact=False)
    if plans.count() == 0:
        return False
    for i in range(plans.count()):
        try:
            if plans.nth(i).is_visible():
                return True
        except Exception:
            continue
    return False


def bb_browse_listing_visible(page: Page) -> bool:
    """5G BB 套餐 browse 列表（允许顶栏待付款横幅仍存在）。"""
    body = page.locator("body").inner_text()
    if "Featured Monthly Plans" in body and re.search(r"HPPRM|5G Broadband|\$168", body, re.I):
        return True
    if _in_offer_configuration(page):
        return False
    if is_draft_application_page(page):
        return False
    return "Featured Monthly Plans" in body


def can_browse_offers(page: Page) -> bool:
    if not bb_browse_listing_visible(page):
        return False
    if pending_payment_visible(page):
        waiting = page.locator(".flex-body").get_by_text(PENDING_PAYMENT_RE)
        if waiting.count() > 0 and waiting.first.is_visible():
            return False
    return True


def has_bb_offer_listing(page: Page) -> bool:
    return (
        _featured_plans_visible(page)
        and not _in_offer_configuration(page)
        and page.get_by_text(BB_LISTING_PRICE_RE).count() > 0
    )


def is_draft_application_page(page: Page) -> bool:
    if has_bb_offer_listing(page):
        return False
    return bool(DRAFT_APPLICATION_RE.search(page.locator("body").inner_text()))


def _try_back_to_browse_from_payment_wait(page: Page, base_url: str | None = None) -> bool:
    """待付款全页（无 chevron-left）时尝试 Back to index / New Subscription / 底部购物车。"""
    if can_browse_offers(page):
        return True
    if not pending_payment_visible(page):
        return False

    check = page.get_by_role("button", name=CHECK_PAYMENT_RE)
    if check.count() > 0 and check.first.is_visible():
        check.first.click(force=True)
        page.wait_for_timeout(800)
        backdrop = page.locator(".cdk-overlay-backdrop:visible")
        if backdrop.count() > 0:
            backdrop.first.click(force=True)
            page.wait_for_timeout(400)
        back = page.get_by_role("button", name=re.compile(r"Back to index", re.I))
        if back.count() > 0 and back.first.is_visible():
            back.first.click(force=True)
            page.wait_for_load_state("networkidle")
            if can_browse_offers(page):
                return True

    for label in (r"Back to index", r"New Subscription"):
        btn = page.get_by_role("button", name=re.compile(label, re.I))
        if btn.count() > 0 and btn.first.is_visible():
            btn.first.click(force=True)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(600)
            if can_browse_offers(page):
                return True
    _click_footer_cart_amount(page)
    if can_browse_offers(page):
        return True
    _click_new_subscription(page)
    if can_browse_offers(page):
        return True

    if base_url:
        page.goto(base_url, wait_until="networkidle", timeout=120_000)
        _click_new_subscription(page)
        if can_browse_offers(page):
            return True

    return can_browse_offers(page)


def exit_draft_application_to_browse(page: Page, max_steps: int = 10) -> None:
    """侧栏点 5G BB 会恢复未完成申请（常落在 payment）；用 chevron-left 退回套餐列表。"""
    if bb_browse_listing_visible(page):
        return
    if _try_back_to_browse_from_payment_wait(page):
        return
    for _ in range(max_steps):
        if can_browse_offers(page):
            return
        chevron = page.locator(".pi-chevron-left:visible")
        if chevron.count() == 0:
            break
        chevron.first.click(force=True)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(400)
    if _try_back_to_browse_from_payment_wait(page):
        return
    if can_browse_offers(page) or bb_browse_listing_visible(page):
        return
    body = page.locator("body").inner_text()
    raise AssertionError(
        "无法从进行中的申请草稿退回 browse 套餐列表。"
        "请在 SIT 取消未完成订单后重试。页面摘要：" + body[:400]
    )


def pending_payment_visible(page: Page) -> bool:
    """顶栏待付款横幅（可能仍在，但不代表不能 browse）。"""
    if page.get_by_text(PENDING_PAYMENT_RE).count() > 0:
        return True
    return page.get_by_role("button", name=CHECK_PAYMENT_RE).count() > 0


def pending_payment_blocks_browse(page: Page) -> bool:
    if can_browse_offers(page):
        return False
    return pending_payment_visible(page)


def parse_footer_cart_amount(page: Page) -> int | None:
    """解析页面底部购物车金额（取最大值；避免 .flex-body 多匹配 strict 报错）。"""
    text = page.locator("body").inner_text()
    amounts: list[int] = []
    for raw in re.findall(r"\$\s*([\d,]+)", text):
        try:
            amounts.append(int(raw.replace(",", "")))
        except ValueError:
            continue
    return max(amounts) if amounts else None


def cart_amount_looks_stale(page: Page) -> bool:
    """异常高金额 = 未完成订单/押金不同步（如 deposit 785040）。"""
    amt = parse_footer_cart_amount(page)
    return amt is not None and amt > MAX_SANE_CART_AMOUNT


def deposit_cart_mismatch_visible(page: Page) -> bool:
    return bool(DEPOSIT_CART_RE.search(page.locator("body").inner_text()))


def _dismiss_deposit_cart_dialogs(page: Page) -> None:
    for scope in (
        page.locator(".p-dialog:visible"),
        page.locator(".p-toast:visible"),
        page.locator(".p-confirm-dialog:visible"),
    ):
        for dialog in scope.all():
            try:
                if not re.search(r"deposit|cart amount", dialog.inner_text(), re.I):
                    continue
            except Exception:
                continue
            for label in ("OK", "Ok", "Confirm", "Close", "Yes", "知道了"):
                btn = dialog.get_by_role("button", name=re.compile(rf"^{label}$", re.I))
                if btn.count() > 0 and btn.first.is_visible():
                    btn.first.click(force=True)
                    page.wait_for_timeout(400)
                    break
            else:
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)


def open_shop_cart_drawer(page: Page) -> None:
    """打开底部购物车侧栏，触发后台重新计价。"""
    _click_footer_cart_amount(page)
    drawer = page.locator(".h-shop-cart.p-sidebar-active, .p-sidebar-bottom.p-sidebar-active")
    if drawer.count() > 0:
        try:
            expect(drawer.first).to_be_visible(timeout=10_000)
        except AssertionError:
            pass
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(800)
    if drawer.count() > 0 and drawer.first.is_visible():
        for label in ("Refresh", "Update", "Recalculate", "Reload"):
            btn = drawer.first.get_by_role("button", name=re.compile(label, re.I))
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click(force=True)
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(600)
                break


def resolve_deposit_cart_mismatch(page: Page, base_url: str | None = None) -> bool:
    """处理「deposit … required, check the cart amount for changes」并同步购物车。"""
    if not deposit_cart_mismatch_visible(page) and not cart_amount_looks_stale(page):
        return False

    _dismiss_deposit_cart_dialogs(page)
    open_shop_cart_drawer(page)
    _close_shop_cart_drawer(page)
    page.wait_for_load_state("networkidle")

    if deposit_cart_mismatch_visible(page) or cart_amount_looks_stale(page):
        if base_url:
            return clear_stale_5g_bb_draft(page, base_url)
    return True


def check_deposit_or_raise_hkid_retry(page: Page, base_url: str) -> None:
    """出现 deposit / 异常购物车金额时：先同步购物车；仍失败则抛出让用例换 HKID。"""
    if not deposit_cart_mismatch_visible(page) and not cart_amount_looks_stale(page):
        return
    resolve_deposit_cart_mismatch(page, base_url)
    if deposit_cart_mismatch_visible(page) or cart_amount_looks_stale(page):
        body = page.locator("body").inner_text()
        snippet = DEPOSIT_CART_RE.search(body)
        msg = snippet.group(0) if snippet else body[-200:]
        raise DepositCartHkidRetry(
            f"deposit/cart 仍不一致，需换 HKID 重跑。摘要: {msg[:180]}"
        )


def _click_footer_cart_amount(page: Page) -> None:
    footers = [
        page.locator(".flex-body").get_by_text(re.compile(r"\$\s*[\d,]+")),
        page.get_by_text(re.compile(r"\$\s*[\d,]+")),
    ]
    for loc in footers:
        if loc.count() == 0:
            continue
        target = loc.last
        if target.is_visible():
            target.click(force=True)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(600)
            return


def _click_new_subscription(page: Page) -> None:
    btn = page.get_by_role("button", name=re.compile(r"New Subscription", re.I))
    if btn.count() > 0 and btn.first.is_visible():
        btn.first.click(force=True)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(400)


def clear_stale_5g_bb_draft(page: Page, base_url: str) -> bool:
    """清除 Step8 待付款草稿（Mongo temporaryOrder/complete + localStorage 5g-bb）。

    源码：草稿存 localStorage['5g-bb']；缺 PAYMENT_TRANSACTION_ID 时 Check Payment Status
    报 Missing payment or draft order context。无法访问 wwwuat 网关时可走此路径解锁 browse。
    """
    body = page.locator("body").inner_text()
    stale = (
        "Waiting for payment done" in body
        or pending_payment_blocks_browse(page)
        or cart_amount_looks_stale(page)
        or deposit_cart_mismatch_visible(page)
    )
    if not stale:
        return False

    temp_id = page.evaluate(
        """() => {
          const raw = localStorage.getItem('TEMPORARY_ORDER_ID');
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return raw; }
        }"""
    )
    if temp_id:
        api = f"{base_url.rstrip('/')}/api/salesPortal/temporaryOrder/complete"
        page.context.request.post(f"{api}?temporaryOrderId={temp_id}")

    page.evaluate(
        """() => {
          localStorage.removeItem('5g-bb');
          for (const k of Object.keys(localStorage)) {
            if (/payment|draft|PAYMENT|DRAFT|SIM_ONLY|COMPLETE/i.test(k)) {
              localStorage.removeItem(k);
            }
          }
          sessionStorage.clear();
        }"""
    )
    force_browse_home(page, base_url)
    page.goto(base_url, wait_until="networkidle", timeout=120_000)
    ok = can_browse_offers(page) and not pending_payment_visible(page)
    return ok


def force_browse_home(page: Page, base_url: str) -> None:
    """强制回到 browse 套餐列表（避免侧栏恢复未完成 Step8 草稿）。"""
    browse_url = f"{base_url.rstrip('/')}/sales/sim-only/select-plan?subModule=primary&flowType=BrowseOffer"
    back = page.get_by_role("button", name=re.compile(r"Back to index", re.I))
    if back.count() > 0 and back.first.is_visible():
        back.first.click(force=True)
        page.wait_for_load_state("networkidle")
    page.goto(browse_url, wait_until="networkidle", timeout=120_000)
    _click_new_subscription(page)


def clear_pending_payment_order(page: Page, base_url: str) -> None:
    """上次 run 未完成付款时，登录页常卡在待付款顶栏；点底部金额或 New Subscription 可回到 browse。"""
    if can_browse_offers(page) and not pending_payment_blocks_browse(page):
        return

    if pending_payment_blocks_browse(page):
        force_browse_home(page, base_url)
        if can_browse_offers(page):
            return

    _click_footer_cart_amount(page)
    if can_browse_offers(page):
        return

    _click_new_subscription(page)
    if can_browse_offers(page):
        return

    if _try_back_to_browse_from_payment_wait(page, base_url):
        return

    if pending_payment_blocks_browse(page):
        body = page.locator("body").inner_text()
        raise AssertionError(
            "登录后仍无法进入 browse（Featured Monthly Plans）。"
            "请点 New Subscription 或取消 SIT 未完成订单。页面摘要：" + body[:400]
        )


def _countdown_confirm_dialog(page: Page):
    """含 app-countdown-button 的可见弹窗（Privacy Policy / 身份证确认等）。"""
    for scope in (
        page.locator("app-privacy-policy-dialog .p-dialog:visible"),
        page.get_by_role("dialog", name=re.compile(r"Privacy Policy", re.I)),
        page.locator(".p-dialog:visible").filter(has=page.locator("app-countdown-button")),
        page.locator("[role='dialog']:visible").filter(has=page.locator("app-countdown-button")),
    ):
        if scope.count() > 0 and scope.first.is_visible():
            return scope.first
    return page.locator(".p-dialog:visible").first


def _countdown_confirm_button(page: Page):
    """弹窗内 countdown-button 的 Confirm（倒数结束后才可点）。"""
    scope = page.locator("app-privacy-policy-dialog, [role='dialog'], .p-dialog:visible")
    btn = scope.locator("app-countdown-button button").filter(
        has_text=re.compile(r"Confirm|確認", re.I)
    )
    if btn.count() > 0:
        return btn.first
    return scope.get_by_role("button", name=re.compile(r"Confirm|確認", re.I)).first


def _wait_countdown_confirm_ready(page: Page, timeout_ms: int = 25_000) -> None:
    """对齐 app-countdown-button：autoStart 倒数期间按钮 disabled，文案含 (N)。"""
    page.wait_for_function(
        """() => {
            const hosts = document.querySelectorAll('app-countdown-button');
            for (const host of hosts) {
                const inDialog = host.closest(
                    'app-privacy-policy-dialog, [role="dialog"], .p-dialog, .p-dialog-mask'
                );
                if (!inDialog) continue;
                const btn = host.querySelector('button');
                if (!btn) continue;
                const text = (btn.textContent || '').trim();
                if (!/confirm|確認/i.test(text)) continue;
                if (btn.disabled || btn.classList.contains('p-disabled')) return false;
                if (/\\(\\s*\\d+\\s*\\)/.test(text)) return false;
                return true;
            }
            return false;
        }""",
        timeout=timeout_ms,
    )


def dismiss_countdown_confirm_dialog(page: Page, *, timeout_ms: int = 25_000) -> None:
    """KYC 身份证/Privacy 等倒数 Confirm：等倒数结束再点，弹窗关闭后再继续。"""
    dialog = _countdown_confirm_dialog(page)
    try:
        expect(dialog).to_be_visible(timeout=8_000)
    except AssertionError:
        return
    if dialog.locator("app-countdown-button").count() == 0:
        return

    confirm = _countdown_confirm_button(page)
    expect(confirm).to_be_visible(timeout=5_000)
    _wait_countdown_confirm_ready(page, timeout_ms=timeout_ms)
    confirm.click()
    page.wait_for_load_state("networkidle")
    try:
        expect(dialog).to_be_hidden(timeout=15_000)
    except AssertionError:
        dismiss_countdown_confirm_dialog(page, timeout_ms=timeout_ms)


def dismiss_privacy_policy_dialog(page: Page) -> None:
    """兼容旧名：KYC 上传证件后的倒数 Confirm 弹窗。"""
    dismiss_countdown_confirm_dialog(page)


def _close_shop_cart_drawer(page: Page) -> None:
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


def dismiss_shop_cart_drawer(page: Page, base_url: str | None = None) -> None:
    if deposit_cart_mismatch_visible(page) or cart_amount_looks_stale(page):
        resolve_deposit_cart_mismatch(page, base_url)
    _close_shop_cart_drawer(page)


def _fill_otp_inputs(inputs: Any, code: str) -> None:
    count = inputs.count()
    if count == 0:
        return
    if count == 1:
        inputs.first.fill(code)
        return
    for i in range(min(count, len(code))):
        inputs.nth(i).fill(code[i])


def _fill_contact_inline_otp(page: Page, code: str) -> bool:
    """Contact Information 内联 OTP 盒（录制路径：Verify 后 3 盒各填 1 位）。"""
    contact = page.get_by_role("region", name=re.compile(r"Contact Information", re.I))
    if contact.count() == 0:
        return False
    extra = contact.first.locator("input:visible").filter(
        has_not=page.locator('[type="hidden"]')
    )
    if extra.count() <= 1:
        return False
    filled = 0
    for i in range(extra.count()):
        box = extra.nth(i)
        try:
            if box.input_value():
                continue
        except Exception:
            continue
        if filled >= len(code):
            break
        box.fill(code[filled])
        filled += 1
    return filled > 0


def _submit_otp_dialog(page: Page, dialog: Any) -> None:
    for label in ("Verify", "Confirm", "Submit", "OK", "Continue"):
        btn = dialog.get_by_role("button", name=re.compile(label, re.I))
        if btn.count() > 0 and btn.first.is_visible():
            btn.first.click(force=True)
            page.wait_for_load_state("networkidle")
            return
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def _wait_dialog_hidden(page: Page, dialog: Any) -> None:
    try:
        expect(dialog).to_be_hidden(timeout=20_000)
    except AssertionError:
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)


def complete_otp_if_present(page: Page) -> None:
    code = get_otp_stub()

    if _fill_contact_inline_otp(page, code):
        page.wait_for_load_state("networkidle")

    dialog = page.get_by_role("dialog").filter(
        has_text=re.compile(r"One-time Password|verification code|OTP|verify", re.I)
    )
    if dialog.count() > 0 and dialog.first.is_visible():
        dlg = dialog.first
        inputs = dlg.locator("input").filter(has_not=page.locator('[type="hidden"]'))
        _fill_otp_inputs(inputs, code)
        _submit_otp_dialog(page, dlg)
        page.wait_for_load_state("networkidle")
        _wait_dialog_hidden(page, dlg)

    if _fill_contact_inline_otp(page, code):
        page.wait_for_load_state("networkidle")

    hint = page.get_by_text("Please verify the mobile", exact=False)
    if hint.count() > 0 and hint.first.is_visible():
        try:
            expect(hint.first).to_be_hidden(timeout=10_000)
        except AssertionError:
            pass
