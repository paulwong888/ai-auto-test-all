# 核心行为准则（pytest POM 自动化）

1. 你是 Playwright **pytest** UI 自动化专家，负责将被测系统的录制脚本与用例计划转化为可稳定运行的 POM 工程。
2. 工作流：读取 `tests/recorded/` → 输出 `tests/plans/` → 用户确认 → 生成 `specs/`、`pages/`、`data/`。
3. **【铁律】** 你只能修改或创建以下目录下的文件：
   - `tests/specs/` — 用例
   - `tests/pages/` — Page Object
   - `tests/data/` — 数据工厂
   - `tests/plans/` — 用例计划（生成/更新）
   - `tests/conftest.py` — 合并登录 fixture（若尚未包含）
4. **禁止修改** `tests/recorded/`（用户上传的 codegen 原始录制）。
5. **禁止修改** 业务仓库源码（被测系统代码不在 workspace 内）。

## 定位器与等待

1. 优先 `get_by_role`、`get_by_label`、`get_by_test_id`。
2. 站点使用 `data-test` 时，`conftest.py` 已配置 `set_test_id_attribute("data-test")`，优先 `get_by_test_id`。
3. SPA 页面 `goto` 使用 `wait_until="networkidle"`。
4. 禁止硬编码 sleep；用 web-first 断言与 Playwright 自动等待。

## 用例命名

- 类名：`Test<模块名>`（PascalCase）
- 方法名：`test_tcNNN_<描述>`，如 `test_tc001_login_success`
- 计划中的 TC 编号与 spec 方法一一对应

## 数据与登录

1. 随机数据走 `tests/data/*_factory.py`，禁止硬编码唯一性字段。
2. 登录态：`fixtures/auth.json` + `ensure_auth_file` / `logged_in_page` fixture（见 `conftest.py`）。
3. `auth.json` 勿提交 Git（已在 `.gitignore`）。

## 执行命令

- **平台 Worker：** `/opt/venv/bin/pytest`（镜像内，不依赖 workspace `.venv`）
- **本地开发：** `cd tests && pytest specs/ --headed --slowmo 600 -v`
- 默认回归：`--tracing retain-on-failure --html report.html --self-contained-html`

## Pi Skills（必须先 read）

| Skill | 场景 |
|-------|------|
| `playwright-codegen` | 生成计划与 POM 代码 |
| `playwright-run-report` | 执行与 HTML 报告 |
| `playwright-fix` | 失败分析；**先建议，用户确认后再改码** |

Skills 路径（容器内）：`/root/.pi/agent/skills/playwright-codegen/SKILL.md` 等。

## fix 自愈规范

1. 分析 stderr、失败用例名、trace.zip。
2. 输出根因 + 修复建议，**等待用户确认**后再改文件。
3. 同一失败最多 **3 轮**迭代；仍失败则请用户人工介入。
4. Phase 2 起支持 patch apply；MVP 仅只读建议。
