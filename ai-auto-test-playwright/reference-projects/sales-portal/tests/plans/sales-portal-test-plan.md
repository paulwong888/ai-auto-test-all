# Sales Portal（CRM）E2E 测试用例计划 — 浏览与选品（MVP）

> **被测系统**：`https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/`  
> **模块名**：`sales-portal`（录制：`tests/recorded/sales-portal.py`）  
> **已实现**：`specs/test_sales_portal.py` · `TestSalesPortal` · **TC-001～TC-007 已在 SIT 跑通**  
> **共享工程**：`tests/conftest.py`（`logged_in_page` 在 auth 过期时自动 SSO 并重写 `fixtures/auth.json`）

---

## 1. 流程梳理

1. 访问门户 → RHSSO Keycloak OIDC 登录（realm `crmweb`，client `crm-web`）
2. 登录成功 → `app-new-header` 可见
3. 点击页头 **空文本按钮** → 打开 `role=complementary` **侧栏**
4. 侧栏 **5G HBB** → **5G BB**（嵌套导航）
5. 列表分页 **2**（须先完成 HBB→BB）
6. 选择套餐卡片（如 **$168 Unlimited data** 等）

---

## 2. POM 规划（已实现）

| 文件 | 类 | 职责 |
|------|-----|------|
| `pages/sso_login_page.py` | `SsoLoginPage` | Keycloak 表单与失败断言 |
| `pages/home_page.py` | `HomePage` | 顶栏、`open_header_menu()` 等待侧栏 5G HBB |
| `pages/product_listing_page.py` | `ProductListingPage` | 侧栏导航、列表刷新、`$168`、分页 |

---

## 3. 数据规划（已实现）

| 文件 | 说明 |
|------|------|
| `data/account_factory.py` | `SALES_PORTAL_USERNAME` / `SALES_PORTAL_PASSWORD`（禁止明文进 Git） |
| `data/offer_factory.py` | 套餐断言关键字 |

---

## 4. TC 清单（MVP，已实现）

| TC 编号 | 方法名 | 登录 | 描述 |
|---------|--------|------|------|
| TC-001 | `test_tc001_sso_login_success` | 完整 SSO | 正确凭据进入门户 |
| TC-002 | `test_tc002_login_invalid_password` | 完整 SSO | 错误密码留在 SSO |
| TC-003 | `test_tc003_header_menu_open` | `logged_in_page` | 侧栏 5G HBB 可见 |
| TC-004 | `test_tc004_navigate_5g_hbb` | `logged_in_page` | 进入 5G HBB |
| TC-005 | `test_tc005_navigate_5g_bb` | `logged_in_page` | HBB 下进入 5G BB |
| TC-006 | `test_tc006_offer_list_pagination` | `logged_in_page` | 分页第 2 页 |
| TC-007 | `test_tc007_select_offer_detail` | `logged_in_page` | 选择套餐卡片 |

TC-008 及以后归属 **独立模块**（见 §7），不在本计划生成范围。

---

## 5. 待确认项

（已全部关闭，决策见 §6。）

---

## 6. 已确认决策

1. **业务主流程**：MVP 止于 TC-007 选套餐/详情可见；**完整下单**另开模块 `sales-portal-order`（见 §7），不在本模块生成代码。
2. **启动数据**：凭据仅经 **环境变量**；TC-001/002 不走 `auth.json`；TC-003+ 用 `logged_in_page`；**auth 过期自动重登**。
3. **登录失败**：TC-002 断言 Keycloak **内联 alert**（Invalid/incorrect 等）；**不测空字段/账号锁定**（未实现 TC003 空字段）。
4. **分页**：按钮 **2** 为列表 **第 2 页**；须 **先 HBB → BB** 再分页。
5. **套餐文案**：SIT 下 **$168 / Featured Monthly Plans** 等作稳定断言。
6. **data-test**：页面暂无稳定 test id；使用 **role + 侧栏结构**。
7. **用例范围**：**仅登录 + 5G 浏览 + 选品（TC-001～007）**。
8. **环境**：Worker 可访问 RHSSO + 门户；`ignore_https_errors=True`。

---

## 7. 多模块索引（同一 Sales Portal 工程）

| moduleName | 录制 | 计划 | 代码 | 说明 |
|------------|------|------|------|------|
| `sales-portal` | `recorded/sales-portal.py` | 本文件 | `specs/test_sales_portal.py` | **MVP 浏览**，已上线 |
| `sales-portal-order` | 建议自 `recorded/saucedemo.py` 迁移命名 | `plans/sales-portal-order-test-plan.md`（待建） | 未生成 | 下单/KYC/支付；**待 §5 业务确认后再 Code** |

> `tests/recorded/saucedemo.py` 为历史误命名（非 Saucedemo 演示站），仅表示 **下单扩展录制**；新功能请用 **`sales-portal-<功能>`** 命名。

---

## 说明

- 本计划为 browse MVP 的权威描述；**无需再对本模块点「确认并生成代码」**（代码已存在）。
- 新功能：**新 moduleName → 录制 → 计划 → §6 → 生成代码**。
- Run：默认跑全量 `tests/`，或按 `specs/test_sales_portal.py` 过滤。
