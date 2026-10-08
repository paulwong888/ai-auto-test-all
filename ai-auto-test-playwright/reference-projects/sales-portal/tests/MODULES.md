# Sales Portal 测试模块

| 模块 ID | Spec | 说明 |
|---------|------|------|
| `sales-portal` | `specs/test_sales_portal.py` | 浏览冒烟 **7** 条（5G HBB/BB、分页、套餐列表等） |
| `sales-portal-order` | `specs/test_sales_portal_order.py` | 下单串联 smoke **1** 条（Cashier 路径，`test_tc100_order_cashier`） |
| `sales-portal-5GBB-0929` | `specs/test_sales_portal_5gbb_0929.py` | 5G BB 在线支付 smoke **1** 条（网关 popup，`test_tc100_5gbb_online_payment`） |

## POM（5GBB 在线支付）

| 文件 | 类 | 对应 Angular 步 |
|------|-----|----------------|
| `pages/sim_service_page.py` | `SimServicePage` | SELECT_SIM + SIGN（ICCID / SSA 条款 / canvas） |
| `pages/payment_method_page.py` | `PaymentMethodPage` | PAYMENT（`app-new-payment`，`OnlinePayment` radio） |
| `pages/step8_complete_page.py` | `Step8CompletePage` | COMPLETE（`app-step8-complete`，自动 `window.open` 网关） |
| `pages/gateway_payment_page.py` | `GatewayPaymentPage` | paygwuat 弹窗 |
| `pages/payment_result_page.py` | `PaymentResultPage` | Check Payment Status / Back to index |

## 计划与可执行用例

- **Plan 页 / workflow** 可按模块切换计划文档（如 `sales-portal-order` 计划中的 TC-008–TC-018 为步骤说明，**不**对应 11 条独立 pytest）。
- **Run 页** 下拉来自 `GET /api/projects/:id/tests/collect`（pytest `--collect-only`），当前合计 **9** 条可执行 nodeId；勿用 plan 正则扫 TC 数当可跑列表。

## 历史 / 归档

- `recorded/saucedemo.py`、`plans/saucedemo-test-plan.md`：早期误命名或模板拷贝，**非** Sauce Demo 被测系统；保留仅供对照录制，不参与 collect 列表。

## 环境

- 凭据与 OTP stub：`SALES_PORTAL_USERNAME` / `SALES_PORTAL_PASSWORD` / `SALES_PORTAL_OTP_STUB`（默认 `aaa`，3 盒各填 1 位）。
- **SIM 轮换（SIT 一次性 ICCID）**：`data/sim_pool.json` 仅轮换 **ICCID**；**Handset IMEI 固定** `860756061810104`（`get_handset_imei()`，env `SALES_PORTAL_TEST_IMEI`）。**报错即 mark used**；Run 结束 `consume_allocated_sim_pair`。覆盖 ICCID：`SALES_PORTAL_TEST_ICCID`；关闭轮换：`SALES_PORTAL_SIM_MODE=fixed`。
- **HKID 轮换（Test ID override）**：`data/hkid_pool.json` 维护 **200** 条 pool；**每次 pytest Run 结束**写入 `hkid_used.json`（`consume_allocated_hkid`），下次 Run 用下一个未用号；用例内 OCR/deposit 失败也会 mark 并换号重试。算法同 [pinkylam HKID generator](https://pinkylam.me/playground/hkid/)。单次覆盖：`SALES_PORTAL_TEST_HKID`；关闭轮换：`SALES_PORTAL_HKID_MODE=fixed`。
- 运行副本：Docker 卷 `/data/projects/sales-portal/tests/`；版本化备份见 `reference-projects/sales-portal/`。
