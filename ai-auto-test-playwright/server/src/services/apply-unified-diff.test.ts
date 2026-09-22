import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyUnifiedDiff } from "./apply-unified-diff.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX_ANALYSIS = path.resolve(
  __dirname,
  "../../../docker/data/projects/www-saucedemo-com/tests/.runs/ffef11fa-3656-40e8-825f-67efa340ba86/fix-analysis.json",
);

const OLD_CONFTEST = `from pathlib import Path

import pytest

BASE_URL = "https://www.saucedemo.com"
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


@pytest.fixture(scope="session")
def ensure_auth_file(browser) -> None:
    """确保 fixtures/auth.json 登录态存在。"""
    if AUTH_FILE.exists():
        return

    context = browser.new_context(base_url=BASE_URL)
    page = context.new_page()
    page.goto(f"{BASE_URL}/", wait_until="networkidle")
    page.get_by_test_id("username").fill("standard_user")
    page.get_by_test_id("password").fill("secret_sauce")
    page.get_by_test_id("login-button").click()
    page.wait_for_url("**/inventory.html")
    context.storage_state(path=str(AUTH_FILE))
    context.close()


@pytest.fixture
def logged_in_page(browser, ensure_auth_file) -> "Page":
    from playwright.sync_api import Page

    context = browser.new_context(
        base_url=BASE_URL, storage_state=str(AUTH_FILE)
    )
    page = context.new_page()
    page.goto(f"{BASE_URL}/inventory.html", wait_until="networkidle")
    yield page
    context.close()
`;

describe("applyUnifiedDiff", () => {
  it("applies Pi malformed multi-hunk patch from fix-analysis.json", () => {
    if (!fs.existsSync(FIX_ANALYSIS)) {
      return;
    }
    const analysis = JSON.parse(fs.readFileSync(FIX_ANALYSIS, "utf8")) as {
      patches: Array<{ unifiedDiff: string }>;
    };
    const diff = analysis.patches[0]?.unifiedDiff;
    expect(diff).toBeTruthy();

    const result = applyUnifiedDiff(OLD_CONFTEST, diff!);
    expect(result).not.toBe(false);
    expect(result).toContain("_auth_is_fresh");
    expect(result).toContain("STANDARD_USER");
  });
});
