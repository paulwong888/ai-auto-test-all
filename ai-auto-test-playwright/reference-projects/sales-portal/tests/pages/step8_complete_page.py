"""COMPLETE 步（app-step8-complete）— 等待支付与网关 popup。"""
import json
import re
from collections.abc import Callable

from playwright.sync_api import BrowserContext, Page, expect

from pages.gateway_payment_page import (
    GATEWAY_GOTO_TIMEOUT_MS,
    assert_gateway_reachable,
    gateway_page_usable,
    preflight_payment_gateway,
)
from pages.order_application_page import OrderApplicationPage
from pages.overlay_helpers import dismiss_shop_cart_drawer
from pages.payment_method_page import PaymentMethodPage

WAITING_PAYMENT_RE = re.compile(r"Waiting for payment done", re.I)
PRIMARY_SIM_RE = re.compile(r"Primary Sim Mobile Number", re.I)
CHECK_STATUS_RE = re.compile(r"Check Payment Status", re.I)
# environment.ogp-sit.ts
ONLINE_PAYMENT_BASE = "https://wwwuat.three.com.hk/DT/postpaid/dev3/tc/checkout/transaction"
PAYMENT_POPUP_TIMEOUT_MS = 25_000


class Step8CompletePage:
    def __init__(self, page: Page) -> None:
        self.page = page

    def expect_waiting_payment(self) -> None:
        dismiss_shop_cart_drawer(self.page)
        body = self.page.locator(".flex-body")
        expect(body.get_by_text(PRIMARY_SIM_RE).first).to_be_visible(timeout=60_000)
        waiting = body.get_by_text(WAITING_PAYMENT_RE)
        check_btn = self.page.get_by_role("button", name=CHECK_STATUS_RE)
        if waiting.count() > 0:
            expect(waiting.first).to_be_visible(timeout=30_000)
        else:
            expect(check_btn.first).to_be_visible(timeout=30_000)

    def wait_for_payment_popup(self, on_trigger: Callable[[], None]) -> Page:
        """Step8 ngOnInit 会在进入 COMPLETE 时自动 window.open 网关。"""
        dismiss_shop_cart_drawer(self.page)
        with self.page.expect_popup(timeout=PAYMENT_POPUP_TIMEOUT_MS) as popup_info:
            on_trigger()
        popup = popup_info.value
        assert_gateway_reachable(popup, context="（Online Payment popup）")
        return popup

    def retry_payment_popup(self) -> Page:
        """fallback：点击 Check Payment Status 再次打开网关。"""
        dismiss_shop_cart_drawer(self.page)
        self.expect_waiting_payment()
        btn = self.page.get_by_role("button", name=CHECK_STATUS_RE).first
        with self.page.expect_popup(timeout=PAYMENT_POPUP_TIMEOUT_MS) as popup_info:
            btn.click(force=True)
        popup = popup_info.value
        assert_gateway_reachable(popup, context="（Check Payment Status popup）")
        return popup

    def obtain_gateway_popup(
        self,
        ctx: BrowserContext,
        on_trigger: Callable[[], None] | None = None,
        *,
        msisdn: str = "45040663",
    ) -> Page:
        """Online Payment 弹出网关；host 不可达或 error 页时快速失败。"""
        preflight_payment_gateway(ctx)

        popup: Page | None = None
        popup_err: BaseException | None = None
        if on_trigger is not None:
            try:
                return self.wait_for_payment_popup(on_trigger)
            except AssertionError:
                raise
            except BaseException as exc:
                popup_err = exc

        if popup is not None and gateway_page_usable(popup):
            return popup
        if popup is not None and not popup.is_closed():
            popup.close()

        self.expect_waiting_payment()
        try:
            popup = self.retry_payment_popup()
            return popup
        except AssertionError:
            raise
        except Exception:
            popup = None

        txn_id = self.ensure_payment_transaction(msisdn=msisdn)
        if not txn_id:
            hint = f" 首次 popup 错误: {popup_err!r}" if popup_err else ""
            raise AssertionError(
                "无法打开支付网关：未弹出支付页且未拿到 PAYMENT_TRANSACTION_ID。"
                "请检查 worker 到 wwwuat.three.com.hk 的路由。"
                + hint
            )
        return self.open_gateway_page(ctx, txn_id, msisdn=msisdn)

    def ensure_payment_transaction(self, msisdn: str = "45040663") -> str | None:
        """缺 PAYMENT_TRANSACTION_ID 时：chevron-left → PAYMENT → next 触发 createPaymentTxnIfNeeded。"""
        txn_holder: dict[str, str | None] = {"id": None}

        def on_resp(response) -> None:
            if "/onlinePayment/" not in response.url or response.request.method != "POST":
                return
            try:
                body = response.json()
                data = body.get("data") or {}
                txn_holder["id"] = (
                    data.get("transactionId")
                    or data.get("crmTxnId")
                    or data.get("paymentTransactionId")
                    or data.get("id")
                )
            except Exception:
                pass

        self.page.on("response", on_resp)
        left = self.page.locator(".pi-chevron-left:visible").first
        if left.count() > 0:
            left.click()
            self.page.wait_for_load_state("networkidle")
            try:
                PaymentMethodPage(self.page).pick_online_payment()
            except Exception:
                online = self.page.locator('input[type="radio"]#OnlinePayment')
                if online.count() > 0 and not online.is_checked():
                    self.page.locator('label[for="OnlinePayment"]').first.click(force=True)
            OrderApplicationPage(self.page).next_step()
            self.page.wait_for_timeout(6_000)

        txn_id = txn_holder["id"]
        if not txn_id:
            raw = self.page.evaluate(
                """() => {
                  const k = 'PAYMENT_TRANSACTION_ID';
                  return localStorage.getItem(k) || sessionStorage.getItem(k);
                }"""
            )
            if raw:
                txn_id = json.loads(raw) if raw.startswith('"') else raw
        return txn_id

    def open_gateway_page(self, ctx: BrowserContext, txn_id: str, msisdn: str = "45040663") -> Page:
        """手动打开网关（popup 被拦截时的 fallback）。"""
        preflight_payment_gateway(ctx)
        url = f"{ONLINE_PAYMENT_BASE}/{msisdn}/{txn_id}?source=hthkshop"
        popup = ctx.new_page()
        try:
            popup.goto(url, wait_until="commit", timeout=GATEWAY_GOTO_TIMEOUT_MS)
        except Exception as exc:
            if not popup.is_closed():
                popup.close()
            raise AssertionError(
                f"支付网关页加载超时/失败（{GATEWAY_GOTO_TIMEOUT_MS}ms）。"
                f" url={url!r} err={exc!r}"
            ) from exc
        assert_gateway_reachable(popup, context="（手动打开网关）")
        return popup
