"""结清 Step8 待在线支付草稿（45040663 / Waiting for payment done!）。

源码行为（step8-complete + can-deactivate-guard）：
- 缺 PAYMENT_TRANSACTION_ID 时 Check Payment Status 报 Missing payment or draft order context
- 从 COMPLETE chevron-left 回 PAYMENT，再 next → createPaymentTxnIfNeeded() 创建 txn
- ngOnInit 的 window.open 仅在首次进入 COMPLETE 时触发；复访需手动打开网关 URL
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.sync_api import sync_playwright

from conftest import AUTH_FILE, BASE_URL
from pages.gateway_payment_page import GatewayPaymentPage
from pages.order_application_page import OrderApplicationPage
from pages.overlay_helpers import can_browse_offers
from pages.payment_method_page import PaymentMethodPage
from pages.payment_result_page import PaymentResultPage
from pages.step8_complete_page import Step8CompletePage

STEP8_URL = (
    "https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk"
    "/sales/5g-bb/complete?subModule=primary&flowType=BrowseOffer"
)
PAY_BASE = "https://wwwuat.three.com.hk/DT/postpaid/dev3/tc/checkout/transaction"
MSISDN = "45040663"


def _ensure_payment_txn(page) -> str | None:
    """退回 PAYMENT 再 next，触发 createPaymentTxnIfNeeded。"""
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

    page.on("response", on_resp)
    page.goto(STEP8_URL, wait_until="networkidle", timeout=120_000)
    page.wait_for_timeout(3_000)

    body = page.locator("body").inner_text()
    if "Waiting for payment done" not in body:
        from pages.product_listing_page import ProductListingPage

        ProductListingPage(page).navigate_5g_bb_resume_draft()
        page.wait_for_timeout(3_000)

    left = page.locator(".pi-chevron-left:visible").first
    if left.count() > 0:
        left.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1_500)
        try:
            PaymentMethodPage(page).pick_online_payment()
        except Exception:
            online = page.locator('input[type="radio"]#OnlinePayment')
            if online.count() > 0 and not online.is_checked():
                page.locator('label[for="OnlinePayment"]').first.click(force=True)
        OrderApplicationPage(page).next_step()
        page.wait_for_timeout(6_000)

    txn_id = txn_holder["id"]
    if not txn_id:
        raw = page.evaluate(
            """() => {
              const k = 'PAYMENT_TRANSACTION_ID';
              return localStorage.getItem(k) || sessionStorage.getItem(k);
            }"""
        )
        if raw:
            txn_id = json.loads(raw) if raw.startswith('"') else raw
    return txn_id


def _open_gateway(ctx, txn_id: str):
    pay_url = f"{PAY_BASE}/{MSISDN}/{txn_id}?source=hthkshop"
    print(f"[settle] gateway url: {pay_url}")
    popup = ctx.new_page()
    popup.goto(pay_url, wait_until="domcontentloaded", timeout=120_000)
    return popup


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--disable-popup-blocking", "--window-size=1280,900"],
        )
        ctx = browser.new_context(
            base_url=BASE_URL,
            ignore_https_errors=True,
            storage_state=str(AUTH_FILE),
            viewport={"width": 1280, "height": 720},
        )
        page = ctx.new_page()

        txn_id = _ensure_payment_txn(page)
        if not txn_id:
            print("[settle] FAILED: no PAYMENT_TRANSACTION_ID after createTxn")
            browser.close()
            return 1
        print(f"[settle] txn_id={txn_id}")

        popup = _open_gateway(ctx, txn_id)
        GatewayPaymentPage(popup).complete_payment()
        if not popup.is_closed():
            popup.close()
        page.bring_to_front()
        page.goto(STEP8_URL, wait_until="networkidle", timeout=120_000)
        page.wait_for_timeout(2_000)

        Step8CompletePage(page).expect_waiting_payment()
        result = PaymentResultPage(page)
        result.check_payment_status()
        result.close_status_overlay()
        page.wait_for_timeout(2_000)

        back = page.get_by_role("button", name="Back to index")
        if back.count() > 0 and back.first.is_visible():
            result.back_to_index()
        else:
            page.wait_for_timeout(5_000)
            if back.count() > 0 and back.first.is_visible():
                result.back_to_index()

        ok = can_browse_offers(page) or "Featured Monthly Plans" in page.locator("body").inner_text()
        print(f"[settle] browse_ok={ok}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
