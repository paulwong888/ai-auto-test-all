from pathlib import Path

import pytest

BASE_URL = "__BASE_URL__"
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
    }


# 登录 fixture（ensure_auth_file / logged_in_page）在 code/generate 生成 pages/ 后由 Pi 合并进本文件。
