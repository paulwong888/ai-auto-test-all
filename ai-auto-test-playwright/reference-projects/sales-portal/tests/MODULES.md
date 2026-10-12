# Sales Portal 测试模块

| 模块 ID | Spec | 说明 |
|---------|------|------|
| `sales-portal` | `specs/test_sales_portal.py` | 浏览冒烟 **7** 条（5G HBB/BB、分页、套餐列表等） |
| `sales-portal-5GBB-0929` | `specs/test_sales_portal_5gbb_0929.py` | 5G BB 全流程 smoke **3** 条：在线 `test_tc100_5gbb_online_payment`、Cashier `test_tc100_5gbb_cash_payment`、Direct Sale `test_tc100_5gbb_direct_sale_payment` |

## POM（5GBB 在线支付）

| 文件 | 类 | 对应 Angular 步 |
|------|-----|----------------|
| `pages/sim_service_page.py` | `SimServicePage` | SELECT_SIM + SIGN（ICCID / SSA 条款 / canvas） |
| `pages/payment_method_page.py` | `PaymentMethodPage` | PAYMENT（`Cashier` / `OnlinePayment` / `DirectSales` radio） |
| `pages/step8_complete_page.py` | `Step8CompletePage` | COMPLETE（`app-step8-complete`，自动 `window.open` 网关） |
| `pages/gateway_payment_page.py` | `GatewayPaymentPage` | paygwuat 弹窗 |
| `pages/payment_result_page.py` | `PaymentResultPage` | Check Payment Status / Back to index |

## 计划与可执行用例

- **Plan 页 / workflow** 可按模块切换计划文档（plan 内 TC 多为步骤说明，**不**一一对应独立 pytest）。
- **Run 页** 下拉来自 `GET /api/projects/:id/tests/collect`（pytest `--collect-only`），当前合计 **10** 条可执行 nodeId；勿用 plan 正则扫 TC 数当可跑列表。
- **Run 录像**：Dashboard Run 页勾选「录像」→ Worker pytest 加 `--video=on`；`logged_in_page` 须用 pytest-playwright 的 `context`（已对齐），产物在 `tests/test-results/**/video.webm`；报告页可预览/下载。

## 历史 / 归档

- `recorded/saucedemo.py`、`plans/saucedemo-test-plan.md`：早期误命名或模板拷贝，**非** Sauce Demo 被测系统；保留仅供对照录制，不参与 collect 列表。

## 环境

- 凭据与 OTP stub：`SALES_PORTAL_USERNAME` / `SALES_PORTAL_PASSWORD` / `SALES_PORTAL_OTP_STUB`（默认 `aaa`，3 盒各填 1 位）。
- **Choose user account（paulhp 多 POS）**：`SALES_PORTAL_POS_ACCOUNT`，默认 `CRM-PAULHP-01`（Cashier + Online）；`CRM-PAULHP-SDIR`（Direct Sale + Online）；`CRM-PAULHP-FORTRESS`（Fortress only）。登录后由 `UserSelectionPage` 自动点选。
- **Direct Sales Second Agent**：POS 为 SDIR 时申请单 **Second Agent** 必填；env `SALES_PORTAL_SECOND_AGENT`（默认 `Test Agent`），`OrderApplicationPage.fill_second_agent_if_required()`。
- **Cashier SIT 销账 API**：`SALES_PORTAL_CRM_API_BEARER`（crm-api Bearer，**必填**）；可选 `SALES_PORTAL_TOPUP_URL`（默认 SIT `topupMultipleWallet`）、`SALES_PORTAL_TOPUP_INFO` / `SALES_PORTAL_TOPUP_MERCHANT_TRAN_ID`（缺省用 `SIM_ONLY_DRAFT_ORDER_ID` 派生 `-105`/`-106`）。`transactionRefId` 取自 localStorage `PAYMENT_TRANSACTION_ID`；`grantAmount` 取自 createTxn 响应 / `TOTAL_PRICE` / 底部购物车金额。
- **平台 Run 注入**：Dashboard **项目概览 → 运行环境变量** 可配置上述 env（敏感项加密存库）；Web Run 时由 API 注入 Worker pytest。本地命令行 pytest 仍可用 shell env 覆盖。
- **Topup HTTPS**：Worker 调 SIT `crm-postpaid-api` 默认 **不校验 SSL**（`SALES_PORTAL_TOPUP_SSL_VERIFY=1` 可开启校验）。
- **SIM 轮换（SIT 一次性 ICCID）**：`data/sim_pool.json` 仅轮换 **ICCID**；**Handset IMEI 固定** `860756061810104`（`get_handset_imei()`，env `SALES_PORTAL_TEST_IMEI`）。**报错即 mark used**；Run 结束 `consume_allocated_sim_pair`。覆盖 ICCID：`SALES_PORTAL_TEST_ICCID`；关闭轮换：`SALES_PORTAL_SIM_MODE=fixed`。
- **HKID 轮换（Test ID override）**：`data/hkid_pool.json` 维护 **200** 条 pool（**不要**从 pool 删号）；已用/跳过写在 Worker 卷 `tests/.state/hkid_used.json`（`mark_hkid_used` / Run 结束 `consume_allocated_hkid`）。SIT 上已占用的号只需 **mark 已用**，不要改 pool。`sync-sales-portal-to-worker.sh` 会保留 Worker 上已有 `hkid_used.json`。单次覆盖：`SALES_PORTAL_TEST_HKID`；关闭轮换：`SALES_PORTAL_HKID_MODE=fixed`。
- 运行副本：Docker 卷 `/data/projects/sales-portal/tests/`；版本化备份见 `reference-projects/sales-portal/`。
