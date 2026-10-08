import os
from pathlib import Path

import pytest
from playwright.sync_api import Browser, BrowserContext, Page, expect

BASE_URL = "https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/"
FIXTURES_DIR = Path(__file__).parent / "fixtures"
AUTH_FILE = FIXTURES_DIR / "auth.json"


@pytest.fixture(scope="session", autouse=True)
def configure_test_id_attribute(playwright) -> None:
    playwright.selectors.set_test_id_attribute("data-test")


@pytest.fixture(autouse=True)
def reset_sim_data_allocation():
    from data.sim_factory import consume_allocated_sim_pair, reset_sim_allocation

    reset_sim_allocation()
    yield
    consume_allocated_sim_pair(reason="test_run")
    reset_sim_allocation()


@pytest.fixture(autouse=True)
def reset_hkid_data_allocation():
    from data.hkid_factory import consume_allocated_hkid, reset_hkid_allocation

    reset_hkid_allocation()
    yield
    consume_allocated_hkid(reason="test_run")
    reset_hkid_allocation()


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args: dict) -> dict:
    return {
        **browser_context_args,
        "base_url": BASE_URL,
        # 自签证书环境
        "ignore_https_errors": True,
        # 对齐 Worker noVNC 1280×900 虚拟屏；窗口最大化后底部购物车条可见
        "viewport": {"width": 1280, "height": 720},
    }


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args: dict) -> dict:
    w = os.environ.get("WORKER_DISPLAY_WIDTH", "1280")
    h = os.environ.get("WORKER_DISPLAY_HEIGHT", "900")
    existing = [
        a
        for a in (browser_type_launch_args.get("args") or [])
        if not a.startswith("--window-size=") and a != "--start-maximized"
    ]
    existing.extend([f"--window-size={w},{h}", "--window-position=0,0"])
    return {**browser_type_launch_args, "args": existing}


def _portal_home_visible(page: Page, timeout_ms: int = 3_000) -> bool:
    try:
        expect(page.locator("app-new-header")).to_be_visible(timeout=timeout_ms)
        return True
    except AssertionError:
        return False


def _sso_login_visible(page: Page, timeout_ms: int = 15_000) -> bool:
    try:
        expect(page.get_by_role("textbox", name="Username or email")).to_be_visible(
            timeout=timeout_ms
        )
        return True
    except AssertionError:
        return False


def _sso_login(context: BrowserContext, page: Page, *, save_auth: bool = False) -> None:
    from pages.home_page import HomePage
    from pages.sso_login_page import SsoLoginPage

    sso = SsoLoginPage(page)
    sso.login()
    HomePage(page).expect_header_visible()
    if save_auth:
        AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(AUTH_FILE))


def _create_auth_file(browser: Browser) -> None:
    """供 scripts/refresh_sso_login 等离线刷新 auth.json 使用。"""
    context = browser.new_context(ignore_https_errors=True, base_url=BASE_URL)
    page = context.new_page()
    try:
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
        _ensure_portal_session(context, page, save_auth=True)
    finally:
        context.close()


def _ensure_portal_session(
    context: BrowserContext, page: Page, *, save_auth: bool = False
) -> None:
    if _portal_home_visible(page, timeout_ms=2_000):
        return
    if _sso_login_visible(page, timeout_ms=15_000):
        _sso_login(context, page, save_auth=save_auth)
        return
    if _portal_home_visible(page, timeout_ms=5_000):
        return
    _sso_login(context, page, save_auth=save_auth)


@pytest.fixture()
def logged_in_page(browser):
    """每次用例新建 context，走 SSO 登录（不复用 fixtures/auth.json）。"""
    context = browser.new_context(
        ignore_https_errors=True,
        base_url=BASE_URL,
    )
    page = context.new_page()
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    _ensure_portal_session(context, page, save_auth=False)
    from pages.overlay_helpers import (
        cart_amount_looks_stale,
        clear_pending_payment_order,
        clear_stale_5g_bb_draft,
        deposit_cart_mismatch_visible,
        resolve_deposit_cart_mismatch,
    )

    clear_pending_payment_order(page, BASE_URL)
    if cart_amount_looks_stale(page) or deposit_cart_mismatch_visible(page):
        clear_stale_5g_bb_draft(page, BASE_URL)
    resolve_deposit_cart_mismatch(page, BASE_URL)
    yield page
    context.close()
