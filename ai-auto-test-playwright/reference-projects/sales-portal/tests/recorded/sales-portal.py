import pytest
import re
from playwright.sync_api import Page, expect


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args, playwright):
    return {"ignore_https_errors": True, "viewport": {"width":1280,"height":720}}


def test_example(page: Page) -> None:
    page.goto("https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/")
    page.goto("https://rhsso.apps.ocpuat.three.com.hk/auth/realms/crmweb/protocol/openid-connect/auth?response_type=code&client_id=crm-web&scope=openid%20email%20profile%20roles%20web-origins%20offline_access&state=_tGfKxcdIilqF7GCB8hfZkO5qpiEJhgWeQvxdX2bDac%3D&redirect_uri=https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/login/oauth2/code/oidc&nonce=89V4_CwC4LsZ4iBT-SmV-mqyTO0hN7gPDScJAGgxZCA")
    page.get_by_role("textbox", name="Username or email").click()
    page.get_by_role("textbox", name="Username or email").fill("paulhp")
    page.get_by_role("textbox", name="Username or email").press("Tab")
    page.get_by_role("textbox", name="Password").fill("#Support1001")
    page.get_by_role("button", name="Sign In").click()
    page.locator("app-new-header").get_by_role("button").filter(has_text=re.compile(r"^$")).click()
    page.locator("a").filter(has_text="5G HBB").click()
    page.locator("a").filter(has_text="5G BB").click()
    page.get_by_role("button", name="2").click()
    page.get_by_role("button", name="3").click()
    page.get_by_label("7").get_by_text("5G Broadband Wi-Fi 6 Service").click()
    page.locator(".pi.pi-chevron-right").click()
    page.locator("i").nth(2).click()
    page.get_by_role("textbox", name="Test ID number (override").click()
    page.get_by_role("textbox", name="Test ID number (override").fill("")
    page.get_by_role("textbox", name="Test ID number (override").click()
    page.get_by_role("textbox", name="Test ID number (override").fill("L")
    page.get_by_role("textbox", name="Test ID number (override").press("ArrowUp")
    page.get_by_role("textbox", name="Test ID number (override").press("PageUp")
    page.get_by_role("textbox", name="Test ID number (override").press("PageDown")
    page.get_by_role("textbox", name="Test ID number (override").press("Home")
    page.get_by_role("textbox", name="Test ID number (override").press("Home")
    page.get_by_role("textbox", name="Test ID number (override").press("ArrowUp")
    page.get_by_role("textbox", name="Test ID number (override").click()
    page.get_by_role("textbox", name="Test ID number (override").press("NumLock")
    page.get_by_role("textbox", name="Test ID number (override").fill("L893778(0)")
    page.locator("i").nth(1).click()
    page.locator("i").nth(2).click()
    page.locator("i").nth(2).click()
    page.locator("i").nth(2).click()
    page.locator("i").nth(2).click(click_count=3)
    page.locator("i").nth(2).click(click_count=3)
