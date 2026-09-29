import pytest
import re
from playwright.sync_api import Page, expect


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args, playwright):
    return {"ignore_https_errors": True}


def test_example(page: Page) -> None:
    page.goto("https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/")
    page.goto("https://rhsso.apps.ocpuat.three.com.hk/auth/realms/crmweb/protocol/openid-connect/auth?response_type=code&client_id=crm-web&scope=openid%20email%20profile%20roles%20web-origins%20offline_access&state=bpKbYFCnYLimRuf0NS4-ZxZpOSOfw3hfZ1UQtN9vBUo%3D&redirect_uri=https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/login/oauth2/code/oidc&nonce=YpKTkpEwS1NXUZGlQkcZCL2qKpwa3kBQHRUFFBhAQLI")
