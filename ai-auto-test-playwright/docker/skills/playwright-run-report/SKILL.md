---
name: playwright-run-report
description: 执行 pytest + Playwright 自动化用例并输出 HTML 测试报告。当用户要求运行生成的 UI 自动化脚本、查看执行结果、输出测试报告或查看 trace 时使用。与 playwright-codegen 拆分为独立 skill，避免单 skill 职责过载。
---

# 执行用例并输出测试报告

独立负责「执行用例 -> 输出报告」环节，报告格式参考 Playwright Test 的 HTML 报告。

## 工作流程

### 1. 执行前检查

- 确认 `tests/specs/` 下有用例文件；无则提示先调用 `playwright-codegen` 生成代码
- 确认依赖已装：`pip install pytest pytest-playwright pytest-base-url`（缺失时）

### 2. 执行用例

```bash
cd tests && pytest specs/ \
  --headed \
  --tracing retain-on-failure \
  --output test-results \
  --html report.html --self-contained-html \
  -v
```

说明：

- **`--headed`（默认）**：有头模式执行；**在本机终端**运行时会弹出浏览器窗口，便于观察
- **经 ai-auto-test-playwright Dashboard / Worker 执行时**：headed 在容器虚拟屏内运行，**不会**在用户桌面弹窗；**debug** preset 可在 Run 页看 noVNC 预览（见 `docs/RUN-VNC.md`）；ci 或无预览时请用终端、报告与 trace
- CI/批量回归时用户明确要求无头，去掉 `--headed` 即可
- `--tracing retain-on-failure`：失败用例自动保留 trace
- 用户可指定范围：单文件 `pytest specs/test_login.py --headed`、单用例 `pytest specs/test_login.py::TestLogin::test_tc001_login_success --headed`
- 无 `pytest-html` 时用 `pip install pytest-html`，或改用 `-p no:cacheprovider --junitxml` + 自建 HTML

### 3. 输出报告

执行完成后在对话中输出汇总，格式参考 Playwright Test 报告：

```
测试结果: X passed, Y failed, Z skipped (耗时 Ns)

失败用例:
- TC-005 新增公寓为空名称校验 — specs/test_apartment_management.py::TestApartmentManagement::test_tc005
  错误: expect(locator).to_be_visible() 超时
  Trace: test-results/.../trace.zip
```

并告知用户：

- HTML 报告位置：`tests/report.html`，浏览器打开查看
- 每个失败用例的 trace 可预览逐步执行过程，确认 AI 执行是否符合预期：
  ```bash
  npx playwright show-trace test-results/<用例目录>/trace.zip
  ```

### 4. 失败处理

有用例失败时，不擅自修改代码，提示用户：调用 `playwright-fix` skill，贴上报错信息或由 AI 读取上下文中的报错进行修复。
