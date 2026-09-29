from pathlib import Path

import pytest
from playwright.sync_api import Browser, BrowserContext, Page, expect

BASE_URL = "https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/"
FIXTURES_DIR = Path(__file__).parent / "fixtures"
AUTH_FILE = FIXTURES_DIR / "auth.json"


@pytest.fixture(scope="session", autouse=True)
def configure_test_id_attribute(playwright) -> None:
    playwright.selectors.set_test_id_attribute("data-test")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args: dict) -> dict:
    return {
        **browser_context_args,
        "base_url": BASE_URL,
        # 自签证书环境
        "ignore_https_errors": True,
    }


def _portal_home_visible(page: Page, timeout_ms: int = 8_000) -> bool:
    try:
        expect(page.locator("app-new-header")).to_be_visible(timeout=timeout_ms)
        return True
    except AssertionError:
        return False


def _sso_login_and_save(context: BrowserContext, page: Page) -> None:
    from pages.home_page import HomePage
    from pages.sso_login_page import SsoLoginPage

    sso = SsoLoginPage(page)
    sso.login()
    HomePage(page).expect_header_visible()
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    context.storage_state(path=str(AUTH_FILE))


def _create_auth_file(browser: Browser) -> None:
    context = browser.new_context(ignore_https_errors=True, base_url=BASE_URL)
    page = context.new_page()
    try:
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
        if not _portal_home_visible(page):
            _sso_login_and_save(context, page)
        else:
            AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
            context.storage_state(path=str(AUTH_FILE))
    finally:
        context.close()


def _ensure_portal_session(context: BrowserContext, page: Page) -> None:
    if _portal_home_visible(page):
        return
    _sso_login_and_save(context, page)


@pytest.fixture(scope="session")
def ensure_auth_file(browser) -> dict:
    """首次运行或缺失 auth.json 时，通过 SSO 登录生成 storage state。"""
    if not AUTH_FILE.exists():
        _create_auth_file(browser)
    return {}


@pytest.fixture()
def logged_in_page(browser, ensure_auth_file):
    """已登录页面；auth.json 过期时在本用例内重新 SSO 并刷新 auth.json。"""
    context = browser.new_context(
        storage_state=str(AUTH_FILE) if AUTH_FILE.exists() else None,
        ignore_https_errors=True,
        base_url=BASE_URL,
    )
    page = context.new_page()
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    _ensure_portal_session(context, page)
    yield page
    context.close()
