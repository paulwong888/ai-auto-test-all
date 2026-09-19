---
name: playwright-codegen
description: 基于 Playwright codegen 录制生成 UI 自动化测试。当用户提供被测系统 URL、要求录制页面操作、生成用例计划或生成 pytest 自动化代码时使用。覆盖 环境检测 -> 启动录制 -> 生成用例计划 -> 人工确认 -> 生成 POM 代码 全流程。
---

# Playwright Codegen 录制与代码生成

人工录制 + AI 生成的 UI 自动化方案：先由 codegen 录制操作产出基础代码，再由 AI 生成用例计划，人工确认后生成可稳定运行的 pytest 代码。

## 工作流程

```
环境检测 -> 启动 codegen 录制 -> 读取录制代码 -> 生成用例计划 -> 人工确认 -> 生成代码
```

### 1. 环境检测

依次检查，缺失则先安装（安装前告知用户）：

```bash
npx --version                 # 无则提示安装 Node.js
npx playwright --version      # 无则执行: npm init -y && npm i -D @playwright/test && npx playwright install chromium
pytest --version              # 无则执行: pip install pytest pytest-playwright
```

### 2. 启动录制

1. 确保目录存在：`mkdir -p tests/recorded tests/plans`
2. 用用户提供的 URL 启动 codegen，输出到 `tests/recorded/`：

```bash
npx playwright codegen <URL> --target python-pytest -o tests/recorded/<模块名>.py
```

3. 提示用户：在打开的浏览器中**完整操作待测业务功能，覆盖每个需要测试的场景**；AI 会读取录制中的页面元素信息以生成更稳定的用例。录制结束后点击 codegen 的终止按钮。

### 3. 生成用例计划

录制结束后，读取 `tests/recorded/` 下的录制代码，生成计划写入 `tests/plans/<模块名>-test-plan.md`，并在对话中输出。计划必须包含：

- **录制的流程梳理**：按录制顺序还原操作步骤
- **页面和 Page Object 规划**：每个页面对应一个 page object 类
- **数据和造数规划**：标识需随机化的数据（如名称用随机码、手机号随机生成 11 位合法号码），规划数据工厂
- **用例清单**：结合用例设计方法（等价类、边界值、场景法）与录制步骤，给出 TC 编号的用例列表
- **待确认项**：列出不确定的步骤/断言点，向用户提问

输出计划后**停下来等待人工检查**。用户可对话完善用例、回答待确认项。

### 4. 生成代码

用户确认计划后，按 Page Object Model 生成代码：

```
tests/
├── conftest.py              # pytest 公共 fixture，失败自动挂 trace 到报告
├── specs/                   # 用例层，一功能模块一文件
│   └── test_<模块>.py       # 类名 Test<Xxx>，方法对应 TC 编号
├── pages/                   # 页面对象层
│   └── <模块>_page.py
├── data/                    # 测试数据工厂
│   └── <模块>_factory.py
├── helpers/                 # 通用工具（验证码、trace 等）
│   └── trace_support.py
├── fixtures/
│   └── auth.json            # 登录态 storage state（如有登录前置）
├── plans/                   # 用例计划
└── recorded/                # codegen 原始录制（保留不改动）
```

生成规范：

- 定位器优先 `get_by_role` / `get_by_label` / `get_by_test_id`，避免脆弱 xpath
- 若站点用 `data-test`（非 `data-testid`），在 `conftest.py` 配置 `playwright.selectors.set_test_id_attribute("data-test")`
- SPA 页面导航时用 `wait_until="networkidle"`，再操作元素
- 每个用例方法名带 TC 编号，如 `test_tc001_login_success`
- 随机数据一律走 data 工厂，不写死在用例里
- 断言明确：元素可见、文本校验、URL 跳转
- 登录态复用：有登录前置时先保存 `storage_state` 到 `fixtures/auth.json`

代码生成完成后提示用户：调用 `playwright-run-report` skill 执行用例并输出报告。
