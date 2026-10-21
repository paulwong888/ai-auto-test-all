# Sales Portal 测试模块

| 模块 ID | Spec | 说明 |
|---------|------|------|
| `sales-portal-5GBB-0929` | `specs/test_sales_portal_5gbb_0929.py` | 5G BB 全流程 smoke **4** 条：在线 / Cashier / Direct Sale / Fortress（`test_tc100_5gbb_*_payment`） |
| `sales-portal-sim-only` | `specs/test_sales_portal_sim_only.py` | Sim Only 全流程 smoke **4** 条：Online / Cashier / Direct Sale / Fortress（`test_tc100_sim_only_*_payment`） |
| `sales-portal-multi-sim` | `specs/test_sales_portal_multi_sim.py` | Multi-SIM 全流程 smoke **4** 条：Online / Cashier / Direct Sale / Fortress（`test_tc100_multi_sim_*_payment`） |

## POM（5GBB 在线支付）

| 文件 | 类 | 对应 Angular 步 |
|------|-----|----------------|
| `pages/sim_service_page.py` | `SimServicePage` | SELECT_SIM + SIGN（ICCID / SSA 条款 / canvas） |
| `pages/payment_method_page.py` | `PaymentMethodPage` | PAYMENT（`Cashier` / `OnlinePayment` / `DirectSales` / `FortressPayment`） |
| `pages/fortress_shop_page.py` | `FortressShopPage` | Fortress Shop ID（`SALES_PORTAL_FORTRESS_SHOP_ID`） |
| `pages/phone_selection_page.py` | `PhoneSelectionPage` | SELECT_PHONE（Channel Number / MNMS 新号） |
| `pages/activation_date_page.py` | `ActivationDatePage` | Select Activation Date（Sim Only 直点 `>`） |
| `pages/step8_complete_page.py` | `Step8CompletePage` | COMPLETE（`app-step8-complete`，自动 `window.open` 网关） |
| `pages/gateway_payment_page.py` | `GatewayPaymentPage` | paygwuat 弹窗 |
| `pages/payment_result_page.py` | `PaymentResultPage` | Check Payment Status / Back to index |

## 计划与可执行用例

- **Plan 页 / workflow** 可按模块切换计划文档（plan 内 TC 多为步骤说明，**不**一一对应独立 pytest）。
- **Run 页** 下拉来自 `GET /api/projects/:id/tests/collect`（pytest `--collect-only`），当前合计 **12** 条可执行 nodeId（已移除 browse 模块 TC-001～TC-007）；勿用 plan 正则扫 TC 数当可跑列表。
- **Run 录像**：Dashboard Run 页勾选「录像」→ Worker pytest 加 `--video=on`；`logged_in_page` 须用 pytest-playwright 的 `context`（已对齐），产物在 `tests/test-results/**/video.webm`；报告页可预览/下载。

## 历史 / 归档

- `recorded/saucedemo.py`、`plans/saucedemo-test-plan.md`：早期误命名或模板拷贝，**非** Sauce Demo 被测系统；保留仅供对照录制，不参与 collect 列表。

## 环境

- 凭据与 OTP stub：`SALES_PORTAL_USERNAME` / `SALES_PORTAL_PASSWORD`（默认 `crmautotest` / `crmautotest`）；`SALES_PORTAL_OTP_STUB`（默认 `aaa`，3 盒各填 1 位）。
- **Choose user account（crmautotest 多 POS）**：`SALES_PORTAL_POS_ACCOUNT`，默认 **`CRM-AUTOTEST-PREPAID001`**（Cashier + Online）；`logged_in_page_simonly` → **`CRM-AUTOTEST-PREPAID001`**；`logged_in_page_sdir` → **`CRM-AUTOTEST-SDIR`**；`logged_in_page_fortress` → **`CRM-AUTOTEST-FORTRESS`**。登录后由 `UserSelectionPage` 自动点选。
- **Direct Sales Second Agent**：POS 为 SDIR 时申请单 **Second Agent** 必填；env `SALES_PORTAL_SECOND_AGENT`（默认 `Test Agent`），`OrderApplicationPage.fill_second_agent_if_required()`。
- **Fortress Shop ID**：POS 为 `CRM-AUTOTEST-FORTRESS` 时 env **`SALES_PORTAL_FORTRESS_SHOP_ID`**（必填，须为 SIT `fortressPaymentShop` 白名单 ID，如 `649`；**不必**与页眉 agent shop 如 `B001` 相同）；`prepare_after_select_offer()` 先激活日再手风琴填写校验；**进 SIM 前** `proceed_to_sim_step` 会再 `fill_and_verify_shop_id()`。
- **进 SIM 前置**：`PaymentPage.advance_after_payment_signature` — Consent 签完立即 ``>``；点 ``>`` 后若 Portal 转圈，`proceed_to_sim_step` **等待 SIM/idle**，不在转场时重复找 canvas 签名。
- **Sim Only 套餐**：可选 env **`SALES_PORTAL_SIM_ONLY_OFFER_KEY`**（套餐卡 `div.box` 匹配文本）；未设则从 browse 列表选首个可见 promotion 卡。
- **Multi-SIM**：菜单 **Monthly Plan** → **Multi-SIM Plan**（browse **`/sales/family-plan/…`** / **`localStorage['family-plan']`**，仅侧栏、无 goto fallback）；套餐卡 **`Multi-SIM`**（`SALES_PORTAL_MULTI_SIM_OFFER_KEY`）。**`SALES_PORTAL_MULTI_SIM_LINE_COUNT`** 默认 **2**；**SELECT_SIM 子步**：Primary **ICCID** → 购物车 ``>`` → Secondary **Channel Number** → 购物车 ``>`` → **Activation Date** → 购物车 ``>`` → Secondary **ICCID**（`SimServicePage._advance_sim_substep_via_cart_footer`，勿用 `.flex-body` 中部 chevron 滚长表单）。
- **Sim Only Choose 1 VAS**：env **`SALES_PORTAL_SIM_ONLY_CHOOSE_ONE_VAS`**（默认 `24-month Handset Switch Lite Service`）；选套餐后必选一项才能 chevron 到选号。
- **Sim Only 选号**：**Channel Number** 下列表 **点第一项** 填入 `#hkMobile`；fallback **Shop Mobile** `.phone-card`；再 fallback env **`SALES_PORTAL_TEST_MSISDN`** 手输 + MNMS blur。选号后点购物车 `>`；若 **Select Activation Date** 再点 `>`（`activation_date_page`，不选日历）。
- **KYC Contact Mobile**：`get_mobile()` — env **`SALES_PORTAL_TEST_MOBILE`** → 默认 **`62304545`**。**Sim Only**：仅填号 + blur，**不 Verify**。**5G BB** 等仍 `ensure_mobile_verified()` + **`SALES_PORTAL_OTP_STUB`**。
- **地址（Contact Mobile 后）**：若页上有 **Street name to search**，`AddressPage.fill_all` 填 **`1`**（env **`SALES_PORTAL_TEST_STREET_SEARCH`**）并点 **联想第一项**；否则仍走 Billing **Street/Estate**（5G BB YEN CHOW 等）。
- **Cashier SIT 销账 API**：`SALES_PORTAL_CRM_API_BEARER`（crm-api Bearer，**必填**）；可选 `SALES_PORTAL_TOPUP_URL`（默认 SIT `topupMultipleWallet`）、`SALES_PORTAL_TOPUP_INFO` / `SALES_PORTAL_TOPUP_MERCHANT_TRAN_ID`（缺省用 draft order 派生 `-105`/`-106`：`family-plan.common` 的 **MULTI_SIM_DRAFT_ORDER_ID** 或 Sim Only 的 **SIM_ONLY_DRAFT_ORDER_ID**）。`transactionRefId` 取自 `PAYMENT_TRANSACTION_ID`；`grantAmount` 取自 createTxn / `TOTAL_PRICE` / 购物车金额。
- **平台 Run 注入**：Dashboard **项目概览 → 运行环境变量** 可配置上述 env（敏感项加密存库）；Web Run 时由 API 注入 Worker pytest。本地命令行 pytest 仍可用 shell env 覆盖。
- **Topup HTTPS**：Worker 调 SIT `crm-postpaid-api` 默认 **不校验 SSL**（`SALES_PORTAL_TOPUP_SSL_VERIFY=1` 可开启校验）。
- **SIM 轮换（SIT 一次性 ICCID）**：`data/sim_pool.json` 仅轮换 **ICCID**；pool 内 **Handset IMEI** 仅作 `allocate_sim_pair` 标记用。**Sim Only / Multi-SIM**：`SimServicePage` 只填 ICCID，校验通过后 **立即 `>`**（`_fill_iccid_and_advance_sim_only`），**不填** IMEI（`is_iccid_only_sim_plan`）；Multi-SIM 默认 **N=2** line。**5G BB** 等仍可为单 ICCID 或录制双框填 IMEI。**报错即 mark used**；Run 结束 `consume_allocated_sim_pair`（Multi-SIM 多 ICCID 一次 mark 多个）。覆盖 ICCID：`SALES_PORTAL_TEST_ICCID`；关闭轮换：`SALES_PORTAL_SIM_MODE=fixed`。
- **HKID 轮换（Test ID override）**：`data/hkid_pool.json` 维护 **200** 条 pool（**不要**从 pool 删号）；已用/跳过写在 Worker 卷 `tests/.state/hkid_used.json`（`mark_hkid_used` / Run 结束 `consume_allocated_hkid`）。SIT 上已占用的号只需 **mark 已用**，不要改 pool。`sync-sales-portal-to-worker.sh` 会保留 Worker 上已有 `hkid_used.json`。单次覆盖：`SALES_PORTAL_TEST_HKID`；关闭轮换：`SALES_PORTAL_HKID_MODE=fixed`。
- 运行副本：Docker 卷 `/data/projects/sales-portal/tests/`；版本化备份见 `reference-projects/sales-portal/`。
