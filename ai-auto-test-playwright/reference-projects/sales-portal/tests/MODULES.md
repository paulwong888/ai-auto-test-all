# Sales Portal 测试模块

| 模块 ID | Spec | 说明 |
|---------|------|------|
| `sales-portal` | `specs/test_sales_portal.py` | 浏览冒烟 **7** 条（5G HBB/BB、分页、套餐列表等） |
| `sales-portal-order` | `specs/test_sales_portal_order.py` | 下单串联 smoke **1** 条（`test_tc100_full_order_application`，`@pytest.mark.smoke`） |

## 计划与可执行用例

- **Plan 页 / workflow** 可按模块切换计划文档（如 `sales-portal-order` 计划中的 TC-008–TC-018 为步骤说明，**不**对应 11 条独立 pytest）。
- **Run 页** 下拉来自 `GET /api/projects/:id/tests/collect`（pytest `--collect-only`），当前合计 **8** 条可执行 nodeId；勿用 plan 正则扫 TC 数当可跑列表。

## 历史 / 归档

- `recorded/saucedemo.py`、`plans/saucedemo-test-plan.md`：早期误命名或模板拷贝，**非** Sauce Demo 被测系统；保留仅供对照录制，不参与 collect 列表。

## 环境

- 凭据与 OTP stub：`SALES_PORTAL_USERNAME` / `SALES_PORTAL_PASSWORD` / `SALES_PORTAL_OTP_STUB`（默认 `000000`）。
- 运行副本：Docker 卷 `/data/projects/sales-portal/tests/`；版本化备份见 `reference-projects/sales-portal/`。
