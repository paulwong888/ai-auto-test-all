# Sales Portal Sim Only 下单 + 在线支付全流程（sales-portal-sim-only）

> 被测系统：`https://sales-portal-ogp-sit-crm.apps.ocpuat.three.com.hk/`
> 模块名：`sales-portal-sim-only`（`specs/test_sales_portal_sim_only.py`）
> 产品线：侧栏 **SIM Plan → Sim Only**（`pathPrefix=sim-only`）

> 与 5G BB 差异：Browse 步序为 **SELECT_PLAN → SELECT_PHONE → CUSTOM_PROFILE**；草稿 `localStorage['sim-only']`。

---

## 1. 流程（TC-100 Online Payment）

1. 登录（`logged_in_page_simonly`，POS **`CRM-AUTOTEST-PREPAID001`**）
2. New Subscription → SIM Plan / Sim Only → More → 选套餐 → **Choose 1** 选 **24-month Handset Switch Lite Service** → **马上点下一步**（chevron）
3. **SELECT_PHONE**：New Number → **Channel Number** 列表 **单击第一个号码**（写入 `#hkMobile`）→ **购物车旁 >**（fallback：Shop `.phone-card` 或 env `SALES_PORTAL_TEST_MSISDN`）
4. **Select Activation Date**（若出现）：**直接再点购物车旁 >**（不选日历）
5. **KYC**：HKID / OCR / **Credit Check**（进 SIM 前 `ensure_credit_check_done` 可重试）→ **Contact Mobile 填 `62304545`**（或 env `SALES_PORTAL_TEST_MOBILE`，**无需 Verify/OTP**）→ 地址 / 信用卡 / Customer Consent **Please sign here** 签名（须写入 pad，不可误判 valid）
6. **SIM**：填 **ICCID**（pool 轮换，blur 校验）→ **库存校验转圈结束即点购物车旁 `>`**（**不填 Handset IMEI**、不在 ICCID 同屏等条款 enabled）→ 下一屏勾选条款 + SSA 页内签名
7. **PAYMENT** → COMPLETE → Back to index（按支付方式分支）：
   - **Online**（`logged_in_page_simonly`）：Online Payment → 网关弹窗
   - **Cashier**（同上 POS）：Cashier → Step8 轮询 Check Payment Status（需 `SALES_PORTAL_CRM_API_BEARER`）
   - **Direct Sale**（`logged_in_page_sdir`，Second Agent）：Direct Sale Payment → Confirm / Check Status
   - **Fortress**（`logged_in_page_fortress`，`SALES_PORTAL_FORTRESS_SHOP_ID`）：Fortress Payment → Step8 Confirm

---

## 2. POM / 数据

| 文件 | 说明 |
|------|------|
| `pages/product_listing_page.py` | `navigate_sim_only_recorded` / `select_sim_only_offer` |
| `pages/phone_selection_page.py` | MNMS 选新号 |
| `pages/kyc_page.py` 等 | 与 5GBB 共用 |
| `data/offer_factory.py` | `get_sim_only_offer()`；env `SALES_PORTAL_SIM_ONLY_OFFER_KEY` |

---

## 3. 可执行用例

| TC | pytest | 说明 |
|----|--------|------|
| TC-100 | `test_tc100_sim_only_online_payment` | 串联 smoke：Sim Only + Online Payment + 网关 |
| TC-100 | `test_tc100_sim_only_cash_payment` | 串联 smoke：Sim Only + Cashier + topup API + Check Status |
| TC-100 | `test_tc100_sim_only_direct_sale_payment` | 串联 smoke：POS SDIR + Direct Sale + Step8 |
| TC-100 | `test_tc100_sim_only_fortress_payment` | 串联 smoke：POS FORTRESS + Shop ID + Fortress Payment |
