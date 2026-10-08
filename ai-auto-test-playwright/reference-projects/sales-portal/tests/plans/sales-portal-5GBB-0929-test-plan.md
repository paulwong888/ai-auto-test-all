# Sales Portal 5G BB 下单 + 在线支付全流程（sales-portal-5GBB-0929）

> 被测系统：`https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/`
> 录制来源：`tests/recorded/sales-portal-5GBB-0929.py`（112 行）
> 模块名：`sales-portal-5GBB-0929`（spec 建议名：`specs/test_sales_portal_5gbb_0929.py`，见待确认项 12）
> 工程约定：Base URL / `data-test` 标识 / 登录 fixture 见 `tests/conftest.py`（`BASE_URL`、`ensure_auth_file`/`logged_in_page`）

> 本计划与既有模块的关系：
> - **登录 + 浏览选套餐** 复用 `sales-portal` 模块 POM（`SsoLoginPage`/`HomePage`/`ProductListingPage`）。
> - **申请向导（KYC/地址/信用卡/SIM）** 复用 `sales-portal-order` 模块 POM（`OrderApplicationPage`/`KycPage`/`AddressPage`/`PaymentPage`/`SimServicePage`/`SignatureDialog`）。
> - **新增差异点**：本次录制比 `sales-portal-order` 多出 **在线支付网关弹窗（paygwuat.hthk.com）→ 支付成功回跳 → Check Payment Status → Back to index** 一整段，是本模块的核心新增覆盖。

---

## 1. 流程梳理

按录制顺序还原的完整业务操作路径（分为 9 个阶段）：

### 阶段 A — SSO 登录（Keycloak）
1. `goto(BASE_URL)` → 302 跳转 RHSSO Keycloak 登录页（realm=`crmweb`，client_id=`crm-web`，OIDC 授权码，redirect_uri=`/login/oauth2/code/oidc`）
2. 输入 Username（录制占位 `username`）/ Password（`password`）→ Enter 登录
3. 回调换取会话 → 落地门户首页（`app-new-header` 可见）

### 阶段 B — 产品线导航 + 分页 + 选套餐
4. 点击 `app-new-header` 内空文本按钮，打开主导航侧栏
5. 点击 **5G HBB** 链接，再点击 **5G BB** 链接
6. 报价列表分页点击数字按钮 **3**（本次直达第 3 页；上次录制为 2→3）
7. 点击套餐卡片 **`HPPRM00000056415G Broadband`**（与上次录制同一套餐编码）

### 阶段 C — 进入申请向导
8. 点击 `.pi.pi-chevron-right`（下一步）
9. 点击 `i.nth(2)`（展开/触发字段区）

### 阶段 D — KYC / 客户身份验证
10. **Test ID number (override)** 填写 **`D161666(9)`**（⚠️ 与上一模块确认值 `L893778(0)` 不同，见待确认项 1）
11. `i.nth(2)` 再次点击，随后通过 `#hkIdUpload` 上传身份证明图片 **`20260929_1452_D1616669.png`**（录制本地文件，仓库不存在 → 用 `fixtures/hkid-sample.png`，见待确认项 2）
12. 点击 **Credit Check**（征信核查）
13. 点击第 3 个 radiobutton（身份/地址证明类目选择）
14. **Contact Mobile** 填写 **`98765432`**（8 位 HK 号），点击 **Verify**（短信校验；录制中未见 OTP 输入步骤，见待确认项 6）

### 阶段 E — 联系地址
15. 三个文本框各填 `a`，第四个框（`input[name="undefined"]`）填 `1`（地址预填字段）
16. 点击地址联想建议 **`1A YEN CHOW STREET, BLOCK A,`**（与上次录制的 `12 ON YU ROAD` 不同地址）
17. 点击 **Kowloon** combobox / **District** 文本框（区域/地区联动）
18. 点击文本 **"Block At least one of the…"**（⚠️ 疑为 **校验提示** 被点中，见待确认项 11；可作为负向用例依据）
19. 填写 **Block** `1`、**Floor** `2`、**Room** `3`
20. 勾选/点选 **No Address Proof** 单选项（无地址证明）

### 阶段 F — 付款方式（信用卡）
21. 分段填信用卡号：`4111` → `1111` → `1111`（Visa 测试卡 `4111 1111 1111 1111`；录制器三次都解析到第一个分段框，实际应为多段输入）
22. 点击 **Credit Card Signature** → 弹窗 canvas 签名（多点划线）→ **Confirm**
23. 填写 **Name On Card** `SOMEBODy`、**Expiration date (MMYY)** `1039`（⚠️ 上次录制为 `1239`，见待确认项 8）
24. 行内 canvas 签名（第 2 次签名）
25. 点击 `.pi.pi-chevron-right`（下一步，进入 SIM 阶段）

### 阶段 G — SELECT_SIM + SIGN（`new-select-sim` / `new-sign`）
26. 填 ICCID（5G BB 主模块通常 **单字段**，blur 触发库存校验；pool 轮换见 `sim_factory`）
27. 等待 SSA 加载完成 → 勾选 **I have read and agree to the** → canvas 签名（第 3 次签名）
28. 点击 `.pi.pi-chevron-right` 进入 PAYMENT 步

### 阶段 G2 — PAYMENT（`app-new-payment`）
29. 选择 **Online Payment**（`p-radioButton` `inputId="OnlinePayment"`）
30. 点击 `.pi.pi-chevron-right` 进入 COMPLETE 步；Step8 `ngOnInit` **自动** `window.open` 网关（`expect_popup`）

### 阶段 H — 支付网关弹窗（paygwuat.hthk.com）★本模块新增
32. 新页面（page1）点击 `.d-flex.py-4` 首个区块，点击 **付款** 按钮
33. 填写：**名字\*** `somebod`、**姓氏\*** `Test`、单选 **Visa**、**信用卡號碼\*** `4111111111111111`、**到期月份\*** `10`、**到期年份\*** `2039`、**CVN\*** `399`
34. 点击 **付款** 提交

### 阶段 I — 支付结果与回门户 ★本模块新增
35. 录制中出现 `page1.goto` 链：`/gp/cy/redirectView` → `checkout/payment?purchaseid=1260929012811` → `…&purchaseStatus=SUCCESS` → `checkout/transaction/90424824/…` → `wwwuat.three.com.hk/DT/postpaid/dev3/tc`（店面前台）
    - ⚠️ 该 goto 链疑为录制器**手工回放跳转**；真实执行时应由网关回调**自动**完成，见待确认项 4
36. 回到原窗口（门户）：点击 **Check Payment Status** → 弹出支付状态 overlay
37. 点击 `.cdk-overlay-backdrop` 关闭弹层
38. 点击 **Back to index** 返回列表页

---

## 2. POM 规划（pages/ 文件清单）

> **复用既有**（不新建、不改动）：`sso_login_page.py`、`home_page.py`、`product_listing_page.py`、`order_application_page.py`、`kyc_page.py`、`address_page.py`、`payment_page.py`、`sim_service_page.py`、`signature_dialog.py`、`checkout_helpers.py`。

| 文件 | Page Object 类 | 状态 | 职责 / 关键元素 |
|------|---------------|------|-----------------|
| `pages/payment_method_page.py` | `PaymentMethodPage` | **新增** | PAYMENT 步；`OnlinePayment` radio；方法 `expect_on_step()`、`pick_online_payment()` |
| `pages/step8_complete_page.py` | `Step8CompletePage` | **新增** | COMPLETE 步；`wait_for_payment_popup()` / `retry_payment_popup()` |
| `pages/gateway_payment_page.py` | `GatewayPaymentPage` | **新增** | 支付网关弹窗页（`paygwuat.hthk.com`）；定位器：`付款` 按钮、`名字 *`/`姓氏 *` 文本框、`Visa` radio、`信用卡號碼 *`、`到期月份 *`/`到期年份 *` 下拉（select_option）、`CVN *`；方法 `fill_payer()`、`fill_card()`、`submit_pay()` |
| `pages/payment_result_page.py` | `PaymentResultPage` | **新增** | 门户侧支付结果区；定位器：**Check Payment Status** 按钮、状态 overlay（`.cdk-overlay-backdrop` 关闭）、**Back to index** 按钮；方法 `check_payment_status()`、`close_status_overlay()`、`back_to_index()` |

> 备注：
> - 弹窗处理：`expect_popup` 后对 page1 实例化 `GatewayPaymentPage`；page1 与主 page 分离，断言互不干扰。
> - 复用的 `SignatureDialog` 覆盖录制中 **3 处 canvas 签名**（信用卡签名弹窗 / 行内签名 / 条款签署）。
> - `KycPage.upload_id_image()` 需兼容本模块上传路径（fixture 图），实现阶段小改或传参，见待确认项 2。
> - `i.nth(2)`、`div:nth-child(2)…radiobutton-box`、`input[name="undefined"]` 等脆弱定位器沿用上模块"临时封装 + 对照 DOM 修正"策略（见待确认项 11）。

---

## 3. 数据规划（data/ factory 清单）

> **复用既有**：`account_factory.py`（env 凭据）、`broadband_factory.py`（随机码/手机号）、`offer_factory.py`（套餐）。

| 文件 | 工厂/常量 | 状态 | 说明 |
|------|----------|------|------|
| `data/kyc_factory.py` | `get_test_hkid()` | 扩展 | 本模块录制覆盖值 **`D161666(9)`**（上模块为 `L893778(0)`）；支持 env `SALES_PORTAL_TEST_HKID` 覆盖，模块间默认值需区分（待确认项 1）。**禁止随机 HKID** |
| `data/kyc_factory.py` | `get_mobile()` | 复用 | Contact Mobile 8 位 HK 号（录制 `98765432`）；默认 `6230xxxx` 随机或 env `SALES_PORTAL_TEST_MOBILE` |
| `data/credit_card_factory.py` | `get_visa_test_card()` | 扩展 | 门户分段卡号 `4111/1111/1111`；有效期本模块 **`1039`**（MMYY）；持卡人名 factory 生成（录制 `SOMEBODy`） |
| `data/credit_card_factory.py` | `get_gateway_card()` | **新增** | 网关页用：卡号 `4111111111111111`、月 `10`、年 `2039`、**CVN `399`**；与门户侧卡号/有效期保持一致的映射逻辑（待确认项 8） |
| `data/address_factory.py` | `get_address()` | 扩展 | 联想建议 **`1A YEN CHOW STREET, BLOCK A,`** + 区域 **Kowloon**；Block/Floor/Room（录制 `1/2/3`）；预填字段 `a`/`a`/`a`/`1` 封装为常量 |
| `data/sim_factory.py` | `get_sim_iccid()` / `get_second_sim()` | 扩展 | 主 ICCID **`898522020071811943`**（重填后的最终值）；第二 SIM **`860756061810104`**；env `SALES_PORTAL_TEST_ICCID` 覆盖（待确认项 9） |
| `data/upload_factory.py` | `get_hkid_image()` | 复用 | 指向 `tests/fixtures/hkid-sample.png`（已存在），**不**依赖录制文件 `20260929_1452_D1616669.png` |
| `data/account_factory.py` | 登录凭据 | 复用 | env `SALES_PORTAL_USERNAME` / `SALES_PORTAL_PASSWORD`；OTP 沿用 `SALES_PORTAL_OTP_STUB`（默认 `000000`） |

---

## 4. TC 清单（方法名）

> 规格文件：`specs/test_sales_portal_5gbb_0929.py`，类名 `TestSalesPortal5GBB0929`。
> TC-001 用完整 SSO；TC-002 起复用 `logged_in_page`（auth.json）。
> 沿用项目惯例：**TC-100 为串联 smoke**（对齐 `sales-portal-order` 的 `test_tc100_full_order_application`）。

| TC 编号 | 方法名 | 描述 | 主要断言 |
|---------|--------|------|---------|
| TC-001 | `test_tc001_sso_login_success` | 正确账号密码 SSO 登录 | URL 回 BASE_URL；`app-new-header` 可见 |
| TC-002 | `test_tc002_nav_5g_hbb_then_bb` | 侧栏导航 5G HBB → 5G BB | 列表刷新，BB 套餐条目可见 |
| TC-003 | `test_tc003_offer_pagination_page3` | 报价列表翻到第 3 页 | 页码 3 选中态、列表内容变化 |
| TC-004 | `test_tc004_select_plan_hpprm5641` | 选择套餐 `HPPRM00000056415G Broadband` | 进入申请向导，套餐编码可见 |
| TC-005 | `test_tc005_wizard_next_step` | 向导下一步进入 KYC 阶段 | Test ID / Credit Check 区可见 |
| TC-006 | `test_tc006_kyc_fill_test_id` | 填 Test ID override（factory/env） | 输入框回显值正确 |
| TC-007 | `test_tc007_kyc_upload_hkid_image` | 上传身份证明图片（fixture） | 上传成功、无报错提示 |
| TC-008 | `test_tc008_kyc_credit_check` | 点击 Credit Check 触发征信核查 | 核查完成态/后续字段解锁 |
| TC-009 | `test_tc009_kyc_contact_mobile_verify` | Contact Mobile + Verify（OTP stub） | Verify 通过提示 |
| TC-010 | `test_tc010_address_autocomplete_select` | 地址联想选择 `1A YEN CHOW STREET, BLOCK A` + Kowloon | 地址字段回填、District 联动 |
| TC-011 | `test_tc011_address_block_floor_room` | 填 Block/Floor/Room | 三项输入回显正确 |
| TC-012 | `test_tc012_address_no_proof_option` | 选择 No Address Proof 单选项 | 单选选中态 |
| TC-013 | `test_tc013_credit_card_fill` | 门户侧分段卡号 + Name On Card + 有效期 1039 | 各字段回显正确 |
| TC-014 | `test_tc014_credit_card_signature_dialog` | 信用卡签名弹窗签名 + Confirm | 弹窗关闭、签名完成标记 |
| TC-015 | `test_tc015_inline_signature_and_next` | 行内 canvas 签名 → 下一步 | 进入 SIM 阶段（SIM 字段可见） |
| TC-016 | `test_tc016_sim_ids_fill` | 填主 ICCID + 第二 SIM | 两个输入框回显值正确 |
| TC-017 | `test_tc017_terms_agree_and_sign` | 条款勾选 + 签署 canvas | checkbox 勾选、签名完成 |
| TC-018 | `test_tc018_choose_online_payment` | 选择在线支付单选项 | 选中态、付款入口可用 |
| TC-019 | `test_tc019_gateway_popup_opens` | 触发付款 → 新窗口打开网关页 | popup URL 含 `paygwuat.hthk.com` |
| TC-020 | `test_tc020_gateway_card_payment` | 网关页填名字/姓氏/Visa/卡号/有效期/CVN 并付款 | 表单回显正确、提交无校验错误 |
| TC-021 | `test_tc021_gateway_success_redirect` | 支付成功回跳（purchaseStatus=SUCCESS） | 回跳 URL/成功态可见（以真实自动跳转为准，见待确认项 4） |
| TC-022 | `test_tc022_check_payment_status` | 门户点击 Check Payment Status | 状态 overlay 弹出并含成功类文案 |
| TC-023 | `test_tc023_back_to_index` | 关闭 overlay → Back to index | 返回列表/首页，向导退出 |
| TC-024 | `test_tc024_block_required_validation` | 不填 Block 直接下一步 → 触发 "At least one of…" 校验 | 校验提示可见（负向/边界，录制中有该提示痕迹） |
| TC-025 | `test_tc025_invalid_mobile_format` | Contact Mobile 填非法格式（>8 位/含字母） | 格式校验错误提示（等价类/边界） |
| TC-026 | `test_tc026_gateway_declined_card` | 网关页提交被拒卡号/CVN 错误 | 网关报错提示、不进入 SUCCESS（负向，视网关沙箱支持，见待确认项 3） |
| TC-100 | `test_tc100_full_5gbb_online_payment` | **串联 smoke**：登录→选套餐→KYC→地址→卡→SIM→网关付款→Check Payment Status→Back to index | 全链路无致命错误；支付状态成功文案；对齐 TC-100 惯例 |

> 实施粒度建议（沿上模块决策 §6.8）：首版仅实现 **TC-100 串联 smoke**（步骤注释引用 TC-005–TC-023）；TC-001–TC-003 浏览段可复用 `sales-portal` spec 不重复实现；TC-024–TC-026 负向用例作为后续拆分。最终以人工确认为准（待确认项 10）。

---

## 5. 待确认项

1. **Test ID override 值**：本模块录制为 `D161666(9)`，上模块已确认 `L893778(0)`。两值是否均为有效 SIT 覆盖值？本模块默认取 `D161666(9)`（env `SALES_PORTAL_TEST_HKID` 可覆盖）还是与上模块统一？
2. **上传图片**：录制引用本地文件 `20260929_1452_D1616669.png`（仓库不存在）。是否沿用已归档的 `tests/fixtures/hkid-sample.png`？若该覆盖值 `D161666(9)` 对图片内容有匹配要求，需提供对应样张。
3. **支付网关自动化范围**：`paygwuat.hthk.com` 为外部网关页。a) 该域名在 SIT 是否稳定可达？b) 名字/姓氏是否需要 factory 随机化（录制 `somebod`/`Test`）？c) CVN `399` 是否固定测试值？d) 是否存在被拒卡场景可供 TC-026 使用？
4. **支付成功跳转链**：真实执行时网关付款后是会**自动回跳**，自动化断言以这个终态为准（ 门户 Check Payment Status 弹窗）`purchaseid=1260929012811` 每次下单会变
5. **Check Payment Status 弹窗**：overlay 内的成功文案/订单号样式是 收款成功
6. **OTP**：录制中 Verify 后未见 OTP 输入步骤。SIT 是否仍为万能码 `SALES_PORTAL_OTP_STUB`（`000000`）？若出现 OTP 输入框是否自动填充？
7. **Contact Mobile**：固定用`98765432` 
8. **有效期不一致**：本模块统一采用 `1039`/10+2039？
9. **SIM 数据**：主 ICCID 录制两次输入（…942 → …943），以 **`…943`** 为准？第二输入框 `860756061810104`（15 位）是 eSIM ICCID 还是别的标识？这些值是否环境固定可用？
10. **用例粒度**：本模块要求拆分独立用例落地
11. **脆弱定位器语义**：`i.nth(2)`（触发弹窗的按钮）、`div:nth-child(2)…radiobutton-box`（支付方式单选）、`input[name="undefined"]`（地址预填第 4 框）、"Block At least one of the…" 文本（是否校验提示）——需对照真实 DOM 确认语义后替换为 role/label/data-test 定位。
12. **模块/spec 命名**：模块名沿用文件名 `sales-portal-5GBB-0929`，spec 文件建议 `specs/test_sales_portal_5gbb_0929.py`（小写规范）；可接受
13. **5G HBB→5G BB 跳转断言**：与 browse 模块一致按 SPA 内容切换断言（不断言 URL）？以及本次录制第 3 页是否稳定存在 `HPPRM00000056415G Broadband`（若分页内容漂移需改用搜索/env `SALES_PORTAL_TEST_OFFER_KEY` 定位）？
---

## 6. 确认项

1. **Test ID override 值**：与上模块统一
2. **上传图片**：沿用已归档的 `tests/fixtures/hkid-sample.png`
3. **支付网关自动化范围**：`paygwuat.hthk.com` 为外部网关页。该网关非真实校验，永远都通过。a) 该域名在 SIT 稳定可达 b) 名字/姓氏需要 factory 随机化（录制 `somebod`/`Test`） c) CVN `399` 是固定测试值 d) 不存在被拒卡场景
4. **支付成功跳转链**：录制中 `page1.goto` 链（redirectView → payment?purchaseStatus=SUCCESS → transaction → 店面前台）疑似录制器手工回放。真实执行时网关付款后是否**自动回跳**？自动化断言以哪个终态为准（transaction 页 URL / SUCCESS 参数 / 门户 Check Payment Status 弹窗）？`purchaseid=1260929012811` 是否一次性、每次下单会变？
5. **Check Payment Status 弹窗**：overlay 内的成功文案/订单号样式是什么？可否提供截屏或 DOM 片段用于收紧断言？
6. **OTP**：录制中 Verify 后未见 OTP 输入步骤。SIT 是否仍为万能码 `SALES_PORTAL_OTP_STUB`（`000000`）？若出现 OTP 输入框是否自动填充？
7. **Contact Mobile**：`98765432` 是否任意 8 位 HK 号均可通过？factory 保持 `6230xxxx` 随机还是固定？
8. **有效期不一致**：门户侧 Expiration (MMYY) `1039`（上次录制 `1239`），网关侧 10/2039。两侧是否必须一致？本模块统一采用 `1039`/10+2039？
9. **SIM 数据**：主 ICCID 以 **`…943`** 为准, 第二输入框 `860756061810104`（15 位）是 imei？这些值暂定环境固定可用
10. **用例粒度**：是否沿用上模块决策（首版仅 1 条串联 smoke TC-100，其余作步骤注释），还是本模块要求拆分独立用例落地？
11. **脆弱定位器语义**：`i.nth(2)`（触发弹窗的按钮）、`div:nth-child(2)…radiobutton-box`（支付方式单选）、`input[name="undefined"]`（地址预填第 4 框）、"Block At least one of the…" 文本（是否校验提示）——需对照真实 DOM 确认语义后替换为 role/label/data-test 定位。
12. **模块/spec 命名**：模块名沿用文件名 `sales-portal-5GBB-0929`，spec 文件建议 `specs/test_sales_portal_5gbb_0929.py`（小写规范）；是否可接受，或另起业务化名称（如 `sales-portal-5gbb-payment`）？
13. **5G HBB→5G BB 跳转断言**：与 browse 模块一致按 SPA 内容切换断言（不断言 URL）？以及本次录制第 3 页是否稳定存在 `HPPRM00000056415G Broadband`（若分页内容漂移需改用搜索/env `SALES_PORTAL_TEST_OFFER_KEY` 定位）？
---

## 说明

- 本计划为 **`sales-portal-5GBB-0929`** 模块权威描述；**§5 待确认项确认后** 方可生成 `specs/test_sales_portal_5gbb_0929.py` 及新增 POM（`gateway_payment_page.py`、`payment_result_page.py`）/data 扩展。
- 生成代码 **不得修改** `tests/recorded/sales-portal-5GBB-0929.py`，也 **不改动** 既有 `sales-portal` / `sales-portal-order` 模块的 spec 与 POM（复用优先，确需扩展时以新增方法/传参实现）。
- 网关页为第三方域：如自动化受 3DS/风控拦截，按上模块决策 §6.7 处理（mock 或人工 mark），首版不硬刚。

---

## 7. 实施状态（2026-10-06 离线落地）

- **TC-100** 已实现：`specs/test_sales_portal_5gbb_0929.py`
- **新增 POM**：`pages/gateway_payment_page.py`、`pages/payment_result_page.py`
- 不经 Dashboard Pi 生成；代码已同步至 worker/server 卷。
