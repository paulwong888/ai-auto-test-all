"""Sales Portal（CRM 销售门户）E2E 用例。

TC001/TC002 为完整 SSO 登录/鉴权用例，不走 auth 复用；
TC003–TC007 通过 logged_in_page 复用 fixtures/auth.json 登录态。
"""
from playwright.sync_api import expect

from data.account_factory import get_wrong_password
from pages.home_page import HomePage
from pages.product_listing_page import ProductListingPage
from pages.sso_login_page import SsoLoginPage


class TestSalesPortal:
    """CRM 销售门户主流程。"""

    # ---------- 登录 / 鉴权 ----------

    def test_tc001_sso_login_success(self, page, base_url) -> None:
        """TC-001 正确账号密码登录，成功进入门户首页。"""
        page.goto(base_url, wait_until="networkidle")
        sso = SsoLoginPage(page)
        sso.login()
        home = HomePage(page)
        home.expect_header_visible()
        assert base_url in page.url

    def test_tc002_login_invalid_password(self, page, base_url) -> None:
        """TC-002 错误密码登录提示报错，不进入门户。"""
        page.goto(base_url, wait_until="networkidle")
        sso = SsoLoginPage(page)
        sso.login(password=get_wrong_password())
        sso.expect_error_visible()
        sso.expect_logged_out()

    # ---------- 导航与列表（复用登录态） ----------

    def test_tc003_header_menu_open(self, logged_in_page) -> None:
        """TC-003 点击页头空文本按钮打开主导航菜单，导航容器出现。"""
        home = HomePage(logged_in_page)
        home.expect_header_visible()
        home.open_header_menu()
        # 点击后主导航（5G HBB / 5G BB）导航容器/链接可见
        expect(logged_in_page.get_by_role("complementary").get_by_text("5G HBB", exact=False).first).to_be_visible()

    def test_tc004_navigate_5g_hbb(self, logged_in_page) -> None:
        """TC-004 通过导航进入 5G HBB 产品线，列表出现 HBB 相关条目。"""
        listing = ProductListingPage(logged_in_page)
        listing.navigate_5g_hbb()
        listing.expect_nav_selected("5G HBB")
        listing.expect_list_refreshed("Broadband")

    def test_tc005_navigate_5g_bb(self, logged_in_page) -> None:
        """TC-005 通过导航进入 5G BB 产品线，列表出现 BB 相关条目。"""
        listing = ProductListingPage(logged_in_page)
        listing.navigate_5g_bb()
        listing.expect_nav_selected("5G BB")
        listing.expect_list_refreshed("Broadband")

    def test_tc006_offer_list_pagination(self, logged_in_page) -> None:
        """TC-006 列表分页，点击数字按钮 2 切换到第 2 页。"""
        listing = ProductListingPage(logged_in_page)
        listing.navigate_5g_bb()
        listing.expect_list_refreshed("Broadband")
        listing.go_to_page(2)
        listing.expect_page_selected(2)
        listing.expect_list_nonempty()

    def test_tc007_select_offer_detail(self, logged_in_page) -> None:
        """TC-007 点击具体报价卡片（$168 Unlimited data）查看套餐详情。"""
        listing = ProductListingPage(logged_in_page)
        listing.navigate_5g_bb()
        listing.expect_list_refreshed("Broadband")
        listing.go_to_page(2)
        listing.select_target_offer()
        listing.expect_offer_detail_visible()
