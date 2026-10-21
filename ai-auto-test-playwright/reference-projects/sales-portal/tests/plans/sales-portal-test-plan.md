# Sales Portal（CRM）E2E — 浏览与选品（已归档）

> **被测系统**：`https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/`  
> **模块名**：`sales-portal`（历史 browse MVP）

> **TC-001～TC-007 已从可执行集移除**（原 `specs/test_sales_portal.py` 已删除）。登录 / 5G 浏览 / 选品能力仍由 **POM**（`SsoLoginPage`、`HomePage`、`ProductListingPage`）供 **TC-100** 全流程模块复用。

---

## 可执行用例

无独立 pytest；请使用：

| 模块 | Spec |
|------|------|
| `sales-portal-5GBB-0929` | `specs/test_sales_portal_5gbb_0929.py` |
| `sales-portal-sim-only` | `specs/test_sales_portal_sim_only.py` |
| `sales-portal-multi-sim` | `specs/test_sales_portal_multi_sim.py` |

---

## 历史 TC-001～007（文档留存，不 collect）

| TC | 原方法名 | 说明 |
|----|----------|------|
| TC-001 | `test_tc001_sso_login_success` | SSO 登录成功 |
| TC-002 | `test_tc002_login_invalid_password` | 错误密码 |
| TC-003 | `test_tc003_header_menu_open` | 打开侧栏 |
| TC-004 | `test_tc004_navigate_5g_hbb` | 5G HBB |
| TC-005 | `test_tc005_navigate_5g_bb` | 5G BB |
| TC-006 | `test_tc006_offer_list_pagination` | 分页 |
| TC-007 | `test_tc007_select_offer_detail` | 选套餐 |

---

## POM（仍维护）

| 文件 | 类 |
|------|-----|
| `pages/sso_login_page.py` | `SsoLoginPage` |
| `pages/home_page.py` | `HomePage` |
| `pages/product_listing_page.py` | `ProductListingPage` |
