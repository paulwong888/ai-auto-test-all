# Sauce Demo 用例计划

> 基于 `tests/recorded/saucedemo.py` 录制生成  
> 被测 URL：https://www.saucedemo.com  
> 生成时间：2026-09-19

---

## 1. 录制的流程梳理

| 步骤 | 操作 | 页面 | 定位器 |
|------|------|------|--------|
| 1 | 打开首页 | Login | — |
| 2 | 点击用户名输入框 | Login | `[data-test="username"]` |
| 3 | 输入 `standard_user` | Login | `[data-test="username"]` |
| 4 | Tab 切换到密码框 | Login | `[data-test="password"]` |
| 5 | 输入 `secret_sauce` | Login | `[data-test="password"]` |
| 6 | 点击 Login | Login | `[data-test="login-button"]` |
| 7 | 加购 Sauce Labs Backpack | Inventory | `[data-test="add-to-cart-sauce-labs-backpack"]` |
| 8 | 点击商品标题进入详情 | Inventory | `[data-test="item-4-title-link"]` |
| 9 | 返回商品列表 | Product Detail | `[data-test="back-to-products"]` |

**录制覆盖范围：** 登录 → 加购 → 查看详情 → 返回列表（Happy Path 片段）

**未录制但建议补充：** 购物车、结算、登出、异常登录、排序

---

## 2. 页面和 Page Object 规划

| Page Object 类 | 文件 | 职责 |
|----------------|------|------|
| `LoginPage` | `pages/login_page.py` | 登录表单、错误提示、跳转断言 |
| `InventoryPage` | `pages/inventory_page.py` | 商品列表、排序、加购、购物车角标、侧边栏 |
| `ProductDetailPage` | `pages/product_detail_page.py` | 商品详情、加购、返回列表 |
| `CartPage` | `pages/cart_page.py` | 购物车列表、移除、Checkout |
| `CheckoutInfoPage` | `pages/checkout_info_page.py` | 填写姓名/邮编、Continue/Cancel |
| `CheckoutOverviewPage` | `pages/checkout_overview_page.py` | 订单摘要、Finish |
| `CheckoutCompletePage` | `pages/checkout_complete_page.py` | 下单成功页断言 |

**公共 fixture：**
- `logged_in_page`：完成登录并停留在 Inventory 页（storage state 复用）
- `auth.json`：登录态持久化到 `fixtures/auth.json`

---

## 3. 数据和造数规划

### 3.1 用户账号（`data/user_factory.py`）

| 类型 | 用户名 | 密码 | 用途 |
|------|--------|------|------|
| 有效用户 | `standard_user` | `secret_sauce` | 正常流程 |
| 锁定用户 | `locked_out_user` | `secret_sauce` | 登录失败 TC |
| 无效用户 | `invalid_user`（随机串） | `secret_sauce` | 登录失败 TC |
| 空密码 | `standard_user` | `` | 边界 TC |

### 3.2 商品数据（`data/product_factory.py`）

| 商品 | data-test 前缀 | 用途 |
|------|----------------|------|
| Sauce Labs Backpack | `sauce-labs-backpack` | 录制主路径 |
| Sauce Labs Bike Light | `sauce-labs-bike-light` | 多商品加购 |
| Sauce Labs Bolt T-Shirt | `sauce-labs-bolt-t-shirt` | 排序/详情 |

### 3.3 结算信息（`data/checkout_factory.py`）

| 字段 | 生成规则 |
|------|----------|
| first_name | `Test` + 4位随机字母 |
| last_name | `User` + 4位随机数字 |
| postal_code | 随机 5 位数字 |

---

## 4. 用例清单

### 4.1 登录模块 — `TestLogin`（`specs/test_login.py`）

| TC | 用例名 | 前置 | 步骤 | 预期 |
|----|--------|------|------|------|
| TC-001 | 有效凭证登录成功 | 无 | 输入 standard_user / secret_sauce → Login | 跳转 Inventory，URL 含 `inventory.html` |
| TC-002 | 无效用户名登录失败 | 无 | 输入 invalid_user / secret_sauce → Login | 显示错误提示，停留 Login 页 |
| TC-003 | 错误密码登录失败 | 无 | 输入 standard_user / wrong_pass → Login | 显示错误提示 |
| TC-004 | 锁定用户登录失败 | 无 | 输入 locked_out_user / secret_sauce → Login | 显示 "locked out" 错误 |
| TC-005 | 空用户名登录失败 | 无 | 用户名留空 → Login | 无法登录或显示校验 |

### 4.2 商品浏览 — `TestInventory`（`specs/test_inventory.py`）

| TC | 用例名 | 前置 | 步骤 | 预期 |
|----|--------|------|------|------|
| TC-006 | 加购 Backpack | 已登录 | 点击 Add to cart (backpack) | 按钮变为 Remove，角标为 1 |
| TC-007 | 查看商品详情 | 已登录 | 点击 Backpack 标题链接 | 进入详情页，显示商品名和描述 |
| TC-008 | 详情页返回列表 | 已登录，在详情页 | 点击 Back to products | 回到 Inventory，商品列表可见 |
| TC-009 | 按名称 A-Z 排序 | 已登录 | 选择 Name (A to Z) | 第一个商品为 Sauce Labs Backpack |
| TC-010 | 按价格 Low to High 排序 | 已登录 | 选择 Price (low to high) | 第一个商品为 Sauce Labs Onesie |

### 4.3 购物车与结算 — `TestCheckout`（`specs/test_checkout.py`）

| TC | 用例名 | 前置 | 步骤 | 预期 |
|----|--------|------|------|------|
| TC-011 | 购物车显示已加商品 | 已登录，已加购 1 件 | 点击购物车图标 | Cart 页显示 Backpack，数量 1 |
| TC-012 | 从购物车移除商品 | 已登录，已加购 | Cart → Remove | 购物车为空，角标消失 |
| TC-013 | 完整结算流程 | 已登录，已加购 1 件 | Cart → Checkout → 填信息 → Continue → Finish | 显示 "Thank you for your order!" |
| TC-014 | 结算信息为空提交 | 已登录，已加购 | Checkout → 留空 → Continue | 显示必填错误提示 |

### 4.4 会话 — `TestSession`（`specs/test_session.py`）

| TC | 用例名 | 前置 | 步骤 | 预期 |
|----|--------|------|------|------|
| TC-015 | 登出 | 已登录 | 打开侧边栏 → Logout | 回到 Login 页 |

---

## 5. 待确认项

1. **用例范围**：录制只覆盖了 TC-006/007/008 的核心路径。是否生成全部 TC-001～015，还是仅生成录制相关的 3 条 + 登录 TC-001？
2. **登录态复用**：是否在 `conftest.py` 里用 `storage_state` 保存登录态，避免每条用例重复登录？
3. **排序断言**：TC-009/010 的商品顺序是否按当前 Sauce Demo 实际 DOM 顺序断言（页面改版可能变化）？
4. **problem_user 账号**：Sauce Demo 的 `problem_user` 有已知 UI bug，是否纳入测试或排除？
5. **visual regression**：是否需要截图对比，还是仅做功能断言？

---

> **下一步：** 请检查用例清单，回复确认或修改意见。确认后执行「生成代码」步骤。
