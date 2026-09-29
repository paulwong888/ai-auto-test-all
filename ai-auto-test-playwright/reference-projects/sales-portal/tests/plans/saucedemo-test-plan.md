# Sales Portal（CRM）E2E 测试用例计划 — 订单/申请全流程

> 被测系统：`https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/`
> 录制来源：`tests/recorded/saucedemo.py`（70 行，比早期浏览版录制更完整）
> 脚本模块名沿用 `saucedemo`
> 工程约定：Base URL / `data-test` 标识 / 登录 fixture 见 `tests/conftest.py`（`BASE_URL`、`ensure_auth_file`/`logged_in_page`）

> ⚠️ 说明：既有 `saucedemo-test-plan.md` 描述的是早期「浏览 + 筛选」流程，已与当前 `tests/recorded/saucedemo.py`（完整下单/申请流程）不符。本版计划**重写**，覆盖从选套餐到提交申请的完整业务路径。

---

## 1. 流程梳理

按录制顺序还原的完整业务操作路径（分为 8 个阶段）：

### 阶段 A — SSO 登录（Keycloak）
1. `goto(BASE_URL)` → 302 跳转到 RHSSO Keycloak 登录页（realm=`crmweb`，client_id=`crm-web`，OIDC 授权码）
2. 输入用户名 `paulhp`、密码 `#Support1001`
3. 点击 **Sign In** → 回调 `/{BASE_URL}/login/oauth2/code/oidc` 换取会话 → 落地门户首页（`app-new-header` 可见）

### 阶段 B — 选产品线 + 选套餐
4. 点击 `app-new-header` 内空文本按钮打开主导航侧栏
5. 点击 **5G HBB**（Home Broadband），再点击 **5G BB**（Business Broadband）
6. 报价列表分页点击数字按钮 **2**、**3**
7. 点击具体套餐卡片：`HPPRM00000056415G Broadband`（套餐编码 + 宽带）

### 阶段 C — 进入申请/结算向导
8. 点击 `.pi.pi-chevron-right`（下一步/继续）
9. 点击 `i.nth(2)`（疑为展开/显示更多字段或触发校验）

### 阶段 D — KYC / 客户身份验证
10. **Test ID number (override)** 字段填写 `L893778(0)`（测试 HKID 覆盖值）
11. 通过 `#hkIdUpload` 上传身份证明图片 `image (5).png`
12. 点击 **Credit Check**（征信/信用核查）按钮
13. 选择第 3 个 radiobutton（推测：身份验证方式/居住证明类型）
14. **Contact Mobile** 字段填写 `62304545`，点击 **Verify**（短信验证）

### 阶段 E — 联系地址
15. 三个文本输入框各填 `a`（街道/区域/…），再填一个 `1`（门牌号等）
16. 选择地址联想建议 `12 ON YU ROAD, ON CHUN HOUSE`
17. 填写 **Block** `11`、**Floor** `11`、**Room** `11`
18. 选择第 3 个 radiobutton（住所类型/证明类目）

### 阶段 F — 付款方式（信用卡）
19. 分三段填信用卡号：`4111` + `1111` + `1111`（疑似 Visa 测试卡号 4111 1111 1111 1111）
20. 点击 **Credit Card Signature** → 弹窗画布签名（canvas）→ **Confirm**
21. 填写 **Name On Card** `11`
22. 填写 **Expiration date (MMYY)** 第一次 `1339` 修正为 `1239`
23. 再次 canvas 签名
24. 点击 `.pi.pi-chevron-right`（下一步）

### 阶段 G — SIM / 服务信息
25. 两个文本框分别填 `898522020071811942`、`860756061810104`（推测：主/副 SIM ICCID 或 IMSI）
26. `i.nth(5)` 点击（展开/刷新）
27. 勾选 **I have read and agree to the**（条款同意）
28. canvas 签名（同意签署）
29. 选择第 3 个 radiobutton
30. 双击 **Primary Sim Mobile Number:** 复制主 SIM 手机号

### 阶段 H — 提交申请
31. 点击 **Yes** 按钮（确认提交申请）

> 录制尾段存在候选/临时输入（如 `L893778(0)` 多为测试覆盖值、`62304545` 为 8 位手机号），正式用例数据应走 data 工厂随机化或按环境配置。

---

## 2. POM 规划（pages/ 文件清单）

> 复用既有：`pages/sso_login_page.py`、`pages/home_page.py`、`pages/product_listing_page.py`（已实现 TC001–TC007 浏览流程）。
> 新增以下订单/申请流程 Page Object。

| 文件 | Page Object 类 | 职责 / 关键元素 |
|------|---------------|-----------------|
| `pages/order_application_page.py` | `OrderApplicationPage` | 申请向导主容器；定位器：下一步 `.pi.pi-chevron-right`、`i.nth` 展开按钮、步进器状态 |
| `pages/kyc_page.py` | `KycPage` | 客户身份验证阶段；定位器：`Test ID number (override)` 文本框、`#hkIdUpload` 文件上传、**Credit Check** 按钮、身份方式 radiobutton、`Contact Mobile` / **Verify** 按钮、OTP 校验 |
| `pages/address_page.py` | `AddressPage` | 联系地址阶段；定位器：地址联想输入、地址建议 `12 ON YU ROAD...`、**Block/Floor/Room** 文本框、住所类型 radiobutton |
| `pages/payment_page.py` | `PaymentPage` | 信用卡付款；定位器：信用卡号分段 `credit-card-input-width` 输入框、**Credit Card Signature** 弹窗 canvas、**Confirm**、**Name On Card**、**Expiration date** 文本框 |
| `pages/sim_service_page.py` | `SimServicePage` | SIM / 服务信息；定位器：ICCID/IMSI 文本框、条款 checkbox、canvas 签名、`Primary Sim Mobile Number:` 复制、radiobutton |
| `pages/signature_dialog.py` | `SignatureDialog` | 通用签名弹窗（多阶段复用）；定位器：`canvas`、**Confirm** 按钮 |

> 备注：
> - 签名 canvas 在各阶段（付款、条款、同意）复用，抽成 `SignatureDialog` 供多个 Page Object 调用。
> - 分步向导「下一步」按钮 `.pi.pi-chevron-right` 各阶段复用，统一封装在 `OrderApplicationPage.next_step()`。
> - 定位稳定性：`i.nth(n)`、`radiobutton:nth-child(3)`、`input[type="text"].nth(n)` 等脆弱选择器需在真实 DOM 中确认语义后，优先替换为 role/label/data-test（见待确认项 4）。

---

## 3. 数据规划（data/ factory 清单）

> 复用既有：`data/account_factory.py`（登录凭据，环境变量注入）、`data/offer_factory.py`（套餐报价）。
> 新增/扩展：

| 文件 | 工厂/常量 | 说明 |
|------|----------|------|
| `data/kyc_factory.py` | `get_kyc_data()` | KYC 身份数据：HKID `L893778(0)`（SIT 测试覆盖值）、`get_mobile()`（随机 8 位 HK 手机号 `6230xxxx`，录制用 `62304545` ）、身份验证方式枚举 |
| `data/credit_card_factory.py` | `get_visa_test_card()` | Visa 测试卡：卡号 `4111 1111 1111 1111`（分段 `4111`/`1111`/`1111`）、持卡人名 `TEST USER`、有效期 `1239`（MMYY）。⚠️ 仅用于 SIT 沙箱，**不得用于生产** |
| `data/address_factory.py` | `get_address()` / `rand_street()` | 地址数据：联想建议 `12 ON YU ROAD, ON CHUN HOUSE`、Block/Floor/Room（随机 `11`～常规值）、随机街道字符串避免唯一性 |
| `data/sim_factory.py` | `get_sim_iccid()` / `get_imsi()` | SIM 数据：主 ICCID `898522020071811942`、副 ICCID `860756061810104`（录制值，SIT 专用）；随机化时走 `rand_code()` |
| `data/upload_factory.py` | `get_hkid_image()` | 身份证明上传文件路径：录制用 `tests/recorded/image (5).png`（—— 需在 fixtures/ 归档可靠测试用图，见待确认项 5） |
| `data/broadband_factory.py`（扩展） | `rand_code()` | 已实现通用随机码/随机手机号，供上述工厂内部复用 |

---

## 4. TC 清单（方法名）

> 规格文件：`specs/test_saucedemo.py`，类名 `TestSaucedemo`。
> 登录拆分：TC001/TC002 完整 SSO；其余复用 `logged_in_page`（auth.json）。
> 订单流用例（TC010+）建议**串联**执行（前一阶段产物是后一阶段前置），或按可回退步骤拆为独立用例——见待确认项 8。

| TC 编号 | 方法名 | 描述 | 主要断言 |
|---------|--------|------|---------|
| TC001 | `test_tc001_sso_login_success` | 正确账号密码登录，进入门户首页 | URL 回 BASE_URL；`app-new-header` 可见 |
| TC002 | `test_tc002_login_invalid_password` | 错误密码登录失败，留在 SSO 页 | `Sign In` 仍可见 + alert/错误区可见 |
| TC003 | `test_tc003_header_menu_open` | 打开主导航侧栏 | complementary 侧栏 5G HBB 链接可见 |
| TC004 | `test_tc004_navigate_5g_hbb` | 进入 5G HBB 产品线 | 列表刷新，出现 Broadband/套餐条目 |
| TC005 | `test_tc005_navigate_5g_bb` | 进入 5G BB 产品线 | 列表刷新，`$168` 套餐可见 |
| TC006 | `test_tc006_offer_list_pagination` | 报价列表翻页（按钮 2/3） | 页码选中态切换、列表内容变化 |
| TC007 | `test_tc007_select_offer` | 选择套餐 `HPPRM00000056415G Broadband` | 选中后进入申请向导/详情可见套餐编码 |
| TC008 | `test_tc008_apply_start` | 选中套餐后进入申请向导（chevron 下一步） | 出现 KYC 阶段（Test ID / Credit Check 区） |
| TC009 | `test_tc009_kyc_id_upload` | 填写 Test ID override + 上传身份图片 | `#hkIdUpload` 文件已上传、无报错 |
| TC010 | `test_tc010_kyc_credit_check` | 点击 Credit Check 触发征信核查 | Credit Check 完成态/下一步可用 |
| TC011 | `test_tc011_kyc_mobile_verify` | 填 Contact Mobile 并 Verify（OTP） | Verify 成功/校验通过提示 |
| TC012 | `test_tc012_address_autocomplete` | 地址联想输入选择 `12 ON YU ROAD` | 地址字段回填所选联想项 |
| TC013 | `test_tc013_address_flat_fill` | 填写 Block/Floor/Room | 三项输入值生效 |
| TC014 | `test_tc014_credit_card_entry` | 分段输入信用卡号 4111...、姓名、有效期 | 卡号/姓名/有效期字段回显正确 |
| TC015 | `test_tc015_credit_card_signature` | 信用卡签名弹窗 canvas 签名并 Confirm | 弹窗关闭、签名已添加标记 |
| TC016 | `test_tc016_sim_info_entry` | 填写主/副 SIM ICCID/IMSI | 两文本框回显值正确 |
| TC017 | `test_tc017_terms_agree` | 勾选条款同意 + 签名 | checkbox 已勾选、签名完成 |
| TC018 | `test_tc018_submit_application` | 点击 **Yes** 提交申请 | 出现提交成功/确认结果页或申请单号 |
| TC019 | `test_tc019_validate_required_field` | 留空必填项校验（如不填地址/卡号） | 必填项报错提示可见（等价类/边界） |
| TC020 | `test_tc020_invalid_hkid_format` | 非法 HKID / 手机号格式拒绝 | 校验错误提示（边界值） |

---

## 5. 待确认项

1. **流程完整性**：当前录制只到「点 **Yes** 提交」结束，未见提交后的成功页/申请单号/错误分支。TC018 的断言点（成功提示、跳转结果页、单号生成）需确认实际落地行为，或补充录制提交流程。
2. **Test ID number (override)**：`L893778(0)` 是 SIT 测试覆盖用的 HKID 值，正式用例如用随机 HKID 是否会触发真实身份校验失败？建议固定使用已授权测试值 + factory 配置，需确认。
3. **Contact Mobile 格式**：录制输入 8 位 `62304545`，非 11 位标准 HK 手机号（`9xxxxxxx`）。确认 SIT 该字段接受格式，决定 factory 是固定 8 位测试号还是生成合规 11 位。
4. **脆弱定位器确认**：`i.nth(2/5)`、`radiobutton:nth-child(3)`、`input[type="text"].nth(n)`、`div:nth-child(9) > ... p-radiobutton` 等选择器缺乏语义。需在真实 DOM 中确认各自业务含义（展开/校验/选项类型），并尽可能替换为 role/get_by_label/data-test，否则 POM 稳定性差。
5. **上传图片素材**：录制上传 `image (5).png`（路径在 recorded/ 下）。请确认该文件是否保留在仓库，或改用 `fixtures/` 下专用测试图，避免依赖 recorded 目录下的临时文件。
6. **短信/OTP 验证**：阶段 D 的 **Verify** 需真实短信 OTP 吗，还是 SIT 提供万能验证码/自动通过？影响 TC011 的稳定性和是否需要 helper（`helpers/` 已规划验证码工具）。
7. **信用卡测试数据**：`4111 1111 1111 1111` 为公认 Visa 测试卡，仅限 SIT 沙箱。确认付款网关在 SIT 接受该卡且无需 3D-Secure/额外授权，避免用例卡死。
8. **用例拆分粒度**：订单/申请流（TC008–TC018）是单一串联「全流程 E2E」用例，还是按阶段拆独立用例（需解决每阶段前置造数/回退成本）？确认首选粒度，影响 specs 组织与数据隔离。
9. **5G HBB / 5G BB 点击后的导航**：SPA 内容切换 vs URL 变化，影响断言方式（沿用既有 `expect_list_refreshed` 约定）。
10. **分页按钮 2/3**：沿用「列表分页页码」理解（与既有 sales-portal 计划一致），如有出入再调整。
11. **「Primary Sim Mobile Number:」双击 + Ctrl+C**：录制用 dblclick + 复制主 SIM 号码，其业务目的是「将主 SIM 号码填入某字段」。确认字段关联与断言目标，避免此操作进入正式用例。

---

## 说明

- 本计划仅描述用例与 POM/data 划分，**不生成** specs/pages/data 代码，不改动 `tests/recorded/saucedemo.py`。
- 既有 `specs/test_sales_portal.py` 对应 `sales-portal` 模块；`saucedemo` 模块独立成 `specs/test_saucedemo.py`，两者可并行（TC001–TC007 有重叠，可考虑合并，见待确认项 8）。
- 待确认项确认后，再基于本计划生成 `pages/`、`data/`、`specs/test_saucedemo.py` 代码。
- 执行用例可调用 `playwright-run-report` skill 输出 HTML 报告。
