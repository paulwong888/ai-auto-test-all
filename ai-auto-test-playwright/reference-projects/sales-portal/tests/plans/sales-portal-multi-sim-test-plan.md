# Sales Portal Multi-SIM 下单 + 支付全流程（sales-portal-multi-sim）

> 被测系统：`https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/`
> 模块名：`sales-portal-multi-sim`（`specs/test_sales_portal_multi_sim.py`）
> 产品线：侧栏 **Monthly Plan → Multi-SIM Plan** → browse **`/sales/family-plan/select-plan?…`**，草稿 **`localStorage['family-plan']`**（Sim Only 为 **`sim-only`** 路径）。导航 **仅侧栏**，路由不对 **直接失败**，无 `goto` fallback。

> 基于 [Sim Only 计划](sales-portal-sim-only-test-plan.md)；Browse：family-plan URL + More + 选含 **Multi-SIM** 的 promotion 卡（默认 key `Multi-SIM`）。

> **SIT 探测结论**：`/sales/multi-sim/…` **404**；Multi-SIM 菜单对应 **family-plan**；SELECT_PHONE 可多轮选号；SELECT_SIM **每 line 仅 ICCID** → **`>`**；smoke 默认 **2** line（`SALES_PORTAL_MULTI_SIM_LINE_COUNT`）。

---

## 1. 流程（TC-100）

1. 登录（Online/Cashier：`logged_in_page_simonly`，POS **`CRM-AUTOTEST-PREPAID001`**；Direct Sale：`logged_in_page_sdir`；Fortress：`logged_in_page_fortress` + **`SALES_PORTAL_FORTRESS_SHOP_ID`**）
2. 侧栏菜单 **Monthly Plan** → **Multi-SIM Plan**（`/sales/family-plan/…`）→ New Subscription → More → 选套餐 → **Choose 1**（env `SALES_PORTAL_MULTI_SIM_CHOOSE_ONE_VAS`）→ **chevron**
3. **SELECT_PHONE**：**Primary**（`subModule=primary`）Channel 首项 + **`>`** → **Secondary SIM** 页（`subModule=secondarySim`，见 `test-feedback/secondarysim.png`）再 Channel 首项 + **`>`**；`#hkMobile` 须 **8 位号码**（勿填 ICCID）；再 **Activation Date / KYC**
4. **Select Activation Date**（若出现）：直点 **`>`**
5. **KYC**：同 Sim Only（Credit Check、`62304545` 不 Verify、地址、信用卡、Customer Consent 签名）
6. **SIM（N 行）**：**Primary ICCID** → **`>`** → **Secondary Channel Number**（选池首项）→ **`>`** → **Select Activation Date**（Secondary，`select-date?subModule=secondarySim`）→ **`>`** → **Secondary ICCID** → 条款 + SSA
7. **PAYMENT** → COMPLETE → Back to index：
   - **Online** / **Cashier** / **Direct Sale** / **Fortress**（与 Sim Only 相同 POS 与 Step8 分支）

---

## 2. POM / 数据

| 文件 | 说明 |
|------|------|
| `pages/product_listing_page.py` | `navigate_multi_sim_recorded` / `select_multi_sim_offer` |
| `pages/overlay_helpers.py` | `multi-sim` draft、`is_iccid_only_sim_plan` |
| `pages/sim_service_page.py` | `fill_sim_ids(lines=N)` 多 ICCID |
| `data/offer_factory.py` | `get_multi_sim_offer()`、`get_multi_sim_line_count()` |

---

## 3. 环境变量

| 变量 | 说明 |
|------|------|
| `SALES_PORTAL_MULTI_SIM_OFFER_KEY` | 套餐卡匹配文本（可选） |
| `SALES_PORTAL_MULTI_SIM_CHOOSE_ONE_VAS` | Choose 1 文案（默认回落 Sim Only VAS） |
| `SALES_PORTAL_MULTI_SIM_LINE_COUNT` | SIM 行数，默认 **2** |
| `SALES_PORTAL_FORTRESS_SHOP_ID` | Fortress smoke 必填 |
| `SALES_PORTAL_CRM_API_BEARER` | Cashier topup 必填 |

---

## 4. 可执行用例

| TC | pytest | 说明 |
|----|--------|------|
| TC-100 | `test_tc100_multi_sim_online_payment` | Multi-SIM + Online Payment + 网关 |
| TC-100 | `test_tc100_multi_sim_cash_payment` | Multi-SIM + Cashier + topup API |
| TC-100 | `test_tc100_multi_sim_direct_sale_payment` | POS SDIR + Direct Sale |
| TC-100 | `test_tc100_multi_sim_fortress_payment` | POS FORTRESS + Shop ID + Fortress Payment |
