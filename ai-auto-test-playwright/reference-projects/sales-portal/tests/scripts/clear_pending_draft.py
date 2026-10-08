"""清除 5G BB 待付款草稿（localStorage + temporaryOrder/complete）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.sync_api import sync_playwright

from conftest import AUTH_FILE, BASE_URL
from pages.overlay_helpers import can_browse_offers, force_browse_home, pending_payment_visible
from pages.product_listing_page import ProductListingPage

TEMP_ORDER_ID = "paulhp_202610060700430449"
STEP8_URL = (
    "https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk"
    "/sales/5g-bb/complete?subModule=primary&flowType=BrowseOffer"
)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--window-size=1280,900"])
        ctx = browser.new_context(
            base_url=BASE_URL,
            ignore_https_errors=True,
            storage_state=str(AUTH_FILE),
        )
        page = ctx.new_page()
        req = ctx.request

        complete = req.post(
            f"{BASE_URL.rstrip('/')}/api/salesPortal/temporaryOrder/complete"
            f"?temporaryOrderId={TEMP_ORDER_ID}"
        )
        print(f"[clear] temporaryOrder/complete -> {complete.status} {complete.text()[:120]}")

        page.goto(BASE_URL, wait_until="networkidle", timeout=120_000)
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

        force_browse_home(page, BASE_URL)
        page.wait_for_timeout(2_000)
        page.goto(BASE_URL, wait_until="networkidle", timeout=120_000)

        body = page.locator("body").inner_text()
        ok = can_browse_offers(page) and not pending_payment_visible(page)
        ok = ok and "45040663" not in body and "Waiting for payment done" not in body
        print(f"[clear] browse_ok={ok} pending={pending_payment_visible(page)}")

        if not ok:
            ProductListingPage(page).navigate_5g_bb_resume_draft()
            page.wait_for_timeout(2_000)
            body = page.locator("body").inner_text()
            still_stuck = "45040663" in body or "Waiting for payment done" in body
            print(f"[clear] after BB nav still_stuck={still_stuck}")
            if still_stuck:
                print("[clear] draft still in MongoDB — need gateway payment or SIT cancel")

        print(body[:350])

        if ok:
            ctx.storage_state(path=str(AUTH_FILE))
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
