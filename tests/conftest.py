from pathlib import Path

import pytest
from playwright.sync_api import Browser, BrowserContext, Page

from data.user_factory import valid_user
from pages.inventory_page import InventoryPage
from pages.login_page import LoginPage

BASE_URL = "https://www.saucedemo.com"
FIXTURES_DIR = Path(__file__).parent / "fixtures"
AUTH_FILE = FIXTURES_DIR / "auth.json"


def _is_auth_valid(browser: Browser, auth_path: Path) -> bool:
    context = browser.new_context(storage_state=str(auth_path), base_url=BASE_URL)
    page = context.new_page()
    try:
        page.goto("/inventory.html", wait_until="networkidle")
        return "inventory.html" in page.url and page.locator(".inventory_list").count() > 0
    finally:
        context.close()


def _save_auth_state(browser: Browser) -> None:
    context = browser.new_context(base_url=BASE_URL)
    page = context.new_page()
    try:
        login = LoginPage(page)
        login.goto()
        username, password = valid_user()
        login.login(username, password)
        InventoryPage(page).assert_loaded()
        context.storage_state(path=str(AUTH_FILE))
    finally:
        context.close()


def ensure_auth_file(browser: Browser, *, force: bool = False) -> Path:
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    if not force and AUTH_FILE.exists() and _is_auth_valid(browser, AUTH_FILE):
        return AUTH_FILE
    _save_auth_state(browser)
    if not _is_auth_valid(browser, AUTH_FILE):
        raise RuntimeError("Failed to create a valid auth storage state")
    return AUTH_FILE


def _open_logged_in_page(browser: Browser, auth_path: Path) -> tuple[Page, BrowserContext]:
    context = browser.new_context(storage_state=str(auth_path), base_url=BASE_URL)
    page = context.new_page()
    page.goto("/inventory.html", wait_until="networkidle")
    return page, context


@pytest.fixture(scope="session", autouse=True)
def configure_test_id_attribute(playwright) -> None:
    playwright.selectors.set_test_id_attribute("data-test")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args: dict) -> dict:
    return {
        **browser_context_args,
        "base_url": BASE_URL,
    }


@pytest.fixture(scope="session")
def auth_file(browser: Browser) -> Path:
    return ensure_auth_file(browser)


@pytest.fixture
def logged_in_page(browser: Browser, auth_file: Path) -> Page:
    page, context = _open_logged_in_page(browser, auth_file)

    if "inventory.html" not in page.url:
        context.close()
        auth_path = ensure_auth_file(browser, force=True)
        page, context = _open_logged_in_page(browser, auth_path)

    InventoryPage(page).assert_loaded()
    yield page
    context.close()
