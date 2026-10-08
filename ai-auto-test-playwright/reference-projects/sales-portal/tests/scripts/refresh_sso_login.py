"""Sales Portal：登出并重新 SSO 登录，刷新 fixtures/auth.json。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.sync_api import sync_playwright

from conftest import AUTH_FILE, BASE_URL, _create_auth_file, _portal_home_visible
from pages.home_page import HomePage
from pages.sso_login_page import SsoLoginPage


def _logout_if_logged_in(page) -> None:
    if not _portal_home_visible(page, timeout_ms=5_000):
        return
    menu = page.locator("button.pi-bars.header-menu-icon, button.pi-bars").first
    menu.click()
    page.wait_for_timeout(800)
    for label in ("Logout", "登出"):
        item = page.get_by_text(label, exact=True)
        if item.count() > 0 and item.first.is_visible():
            item.first.click()
            page.wait_for_load_state("networkidle")
            break
    page.wait_for_timeout(1_000)


def main() -> int:
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    storage = str(AUTH_FILE) if AUTH_FILE.is_file() else None
    if storage:
        print(f"[refresh] using existing {AUTH_FILE}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--window-size=1280,900", "--window-position=0,0"],
        )
        context = browser.new_context(
            storage_state=storage,
            base_url=BASE_URL,
            ignore_https_errors=True,
            viewport={"width": 1280, "height": 720},
        )
        page = context.new_page()
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)

        if _portal_home_visible(page):
            print("[refresh] logout via header menu")
            _logout_if_logged_in(page)

        if not _portal_home_visible(page, timeout_ms=5_000):
            print("[refresh] SSO login…")
            SsoLoginPage(page).login()
            HomePage(page).expect_header_visible()

        context.storage_state(path=str(AUTH_FILE))
        body = page.locator("body").inner_text()
        print(f"[refresh] auth saved; logged in as contains paulhp={'paulhp' in body.lower()}")
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
