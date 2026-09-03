# API Test Platform — 代码解读文档

> 项目路径：`c:\Users\65132\Desktop\1\api-test-platform`  
> 文档生成日期：2026-07-17  
> 配套文档：[本地运行环境安装及部署文档](deployment.md)

---

## 目录

1. [项目定位](#一项目定位)
2. [系统架构总览](#二系统架构总览)
3. [目录结构](#三目录结构)
4. [核心入口解析](#四核心入口解析)
5. [子智能体](#五子智能体agents)
6. [工具层](#六工具层tools)
7. [管理 API](#七管理-apiapimainpy)
8. [数据库层](#八数据库层servicesdbpy--migrations001_initsql)
9. [前端 UI](#九前端-uiui)
10. [典型工作流](#十典型工作流)
11. [测试与验证](#十一测试与验证)
12. [已知问题](#十二已知问题)
13. [关键依赖](#十三关键依赖)
14. [总结](#十四总结)

---

## 一、项目定位

**API Test Platform（智能 API 测试平台）** 是一个基于 **DeepAgents 多智能体架构** 的企业级 API 自动化测试平台。核心目标是通过 AI Agent 协同完成：

1. **代码变更 → API 影响范围分析**：利用 CodeGraph 追踪代码改动影响到的 API 路由
2. **智能测试生成**：从 OpenAPI/Swagger 自动生成正向/负向/边界测试用例和 pytest 脚本
3. **测试自动执行**：通过 pytest + requests/httpx + Schemathesis 执行冒烟、回归、契约、单接口调试
4. **结构化报告生成**：汇总测试结果、失败分析、性能数据和改进建议

---

## 二、系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  UI 层 (Next.js 15 + React 19)  :3000                       │
│  ├── /              → Chat 对话界面（LangGraph SSE 流式）    │
│  └── /admin         → 管理后台（项目 / 运行 / 报告）         │
├─────────────────────────────────────────────────────────────┤
│  LangGraph API Server (:8200)                               │
│  └── agent.py → Supervisor + 4 子智能体                     │
├─────────────────────────────────────────────────────────────┤
│  FastAPI 管理 API (:8100)                                   │
│  └── api/main.py → 项目 / 运行 / 报告 / 分析 / 测试 REST 接口│
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL (:5432)  +  Redis (:6379)                       │
└─────────────────────────────────────────────────────────────┘
```

### 数据流向

1. 用户通过 `ui/` 前端与 Supervisor Agent 对话，或直接在 `/admin` 触发操作
2. Supervisor 根据意图调度 4 个子智能体中的一个或多个
3. 子智能体通过 `tools/` 层执行具体任务（CodeGraph 分析、pytest 执行、OpenAPI 生成）
4. `api/main.py` 提供与 Agent 对齐的 REST API，供前端管理后台调用
5. `services/db.py` 将项目、运行、结果、报告持久化到 PostgreSQL

---

## 三、目录结构

```
api-test-platform-python/
├── backend/                  # Python 后端
│   ├── agent.py              # Supervisor 主编排器入口
│   ├── langgraph.json        # LangGraph 服务配置
│   ├── requirements.txt
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── pytest.ini
│   ├── migrations/001_init.sql
│   ├── agents/
│   ├── tools/
│   ├── services/db.py
│   ├── api/main.py
│   └── workspace/
│
├── ui/                       # Next.js 前端
│   ├── src/app/page.tsx
│   ├── src/app/admin/page.tsx
│   └── package.json
│
├── docker/                   # Docker 与运维
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── start.sh / restart.sh / shutdown.sh / logs.sh
│   ├── langgraph/Dockerfile
│   ├── api/Dockerfile
│   └── ui/Dockerfile
│
└── docs/
```

---

## 四、核心入口解析

### 4.1 `agent.py` — Supervisor 主编排器

**核心职责：**

| 函数/变量 | 作用 |
|-----------|------|
| `_build_subagents()` | 组装 4 个子智能体配置 |
| `_build_backend()` | 构建 DeepAgents 后端（state/local_shell/composite） |
| `inject_project_context` | 中间件：把项目元数据注入为 system message |
| `get_agent()` | 单例创建 Supervisor Agent |
| `graph()` | LangGraph API 入口 |
| `test()` | 本地快速冒烟测试 |

**关键配置项（来自 `.env`）：**

```python
MODEL_PROVIDER = os.getenv("MODEL_PROVIDER", "deepseek")
MODEL_NAME = os.getenv("MODEL_NAME", "deepseek-v4-flash")
BACKEND_TYPE = os.getenv("BACKEND_TYPE", "local_shell")
BACKEND_ROOT_DIR = Path(os.getenv("BACKEND_ROOT_DIR", os.getcwd())).resolve()
```

**Windows UTF-8 补丁：**

`agent.py` 第 48–154 行对 `LocalShellBackend.execute` 做了 monkey-patch，强制 `subprocess.run` 使用 `encoding="utf-8"` 和 `errors="replace"`。这是为了解决 Windows 中文环境下默认编码 `cp936/gbk` 解码 UTF-8 输出时崩溃，导致 LangGraph 运行被取消的问题。

**项目上下文注入（第 184–242 行）：**

```python
class ProjectContext(BaseModel):
    project_id: str | None = None

@before_agent
async def inject_project_context(state, runtime):
    # 把 project_id 对应的项目信息追加为 system message
```

当前端传入 `project_id` 时，Supervisor 会自动把项目的 `openapi_spec`、`base_url`、`repo_url` 等注入对话，避免 Agent 猜测路径。

### 4.2 `langgraph.json`

```json
{
  "dependencies": ["."],
  "graphs": {
    "api-test-platform": "agent:graph"
  },
  "env": ".env"
}
```

- `dependencies: ["."]`：当前目录作为依赖包
- `graphs`：注册名为 `api-test-platform` 的图，入口是 `agent.py` 中的 `graph()` 函数
- `env`：加载 `.env` 中的环境变量

---

## 五、子智能体（agents/）

每个子智能体由 `get_*_config(model_spec)` 返回一个配置字典：

```python
{
    "name": "code-analyzer",
    "description": "...",
    "system_prompt": "...",
    "model": "openai:deepseek-v4-pro",
}
```

| Agent | 文件 | 职责 | 分配给的工具 |
|-------|------|------|-------------|
| `code-analyzer` | `code_analyzer.py` | 代码变更 → API 影响范围 | `CODE_TOOLS` + `PROJECT_TOOLS` |
| `api-tester` | `api_tester.py` | 执行 API 测试 | `API_TOOLS` + `PROJECT_TOOLS` |
| `test-generator` | `test_generator.py` | 从 OpenAPI 生成用例和脚本 | `API_TOOLS` + `PROJECT_TOOLS` |
| `report-writer` | `report_writer.py` | 汇总生成测试报告 | `PROJECT_TOOLS` |

子智能体本身不包含业务逻辑，仅通过 system prompt 定义行为；业务逻辑集中在 `tools/` 层。

---

## 六、工具层（tools/）

### 6.1 `tools/__init__.py` 工具分组

```python
CODE_TOOLS = list(CODEGRAPH_TOOLS)              # 4 个
API_TOOLS = list(API_TEST_TOOLS) + list(API_GEN_TOOLS)  # 6 + 3 = 9 个
SUPERVISOR_TOOLS = list(PROJECT_TOOLS)          # 2 个
```

### 6.2 `codegraph_tools.py` — 代码智能

封装 CodeGraph CLI 的 4 个能力，均通过 `_run_codegraph()` 执行命令：

| 工具 | 对应 CLI | 用途 |
|------|---------|------|
| `codegraph_affected` | `codegraph affected --json` | 检测变更影响，输出受影响 API 路由和测试文件 |
| `codegraph_explore` | `codegraph explore --json` | 自然语言/结构化查询代码架构 |
| `codegraph_search` | `codegraph search --json` | 搜索符号调用链 |
| `codegraph_callers` | `codegraph callers --json` | 查找某个符号的调用者 |

**环境变量：**

- `CODEGRAPH_PATH`：CLI 可执行文件路径（默认 `codegraph`）
- `CODEGRAPH_DEFAULT_PROJECT`：分析目标项目路径（默认当前目录）

### 6.3 `api_test_tools.py` — 测试执行

| 工具 | 类型 | 用途 |
|------|------|------|
| `run_api_tests` | sync | 运行 pytest 套件，支持 marker/并行/HTML 报告 |
| `run_single_test` | sync | 运行单个测试用例（`-k` 匹配） |
| `run_api_request` | sync | 直接发送单个 HTTP 请求，用于单接口调试 |
| `validate_api_contract` | sync | 使用 Schemathesis 执行 OpenAPI 契约测试 |
| `validate_json_schema` | sync | JSON Schema 校验 |
| `get_test_results` | async | 从数据库查询历史运行记录 |

`run_api_tests` 默认工作目录：

```python
DEFAULT_TEST_DIR = Path(os.getenv("API_TEST_DIR")) or (Path.cwd() / "workspace" / "test_suites")
```

### 6.4 `api_gen_tools.py` — 测试生成

| 工具 | 用途 |
|------|------|
| `parse_openapi_spec` | 解析 OpenAPI 2.0/3.0/3.1 JSON/YAML 或远程 URL |
| `generate_api_test_cases` | 生成正向、负向、边界测试用例 JSON |
| `generate_pytest_script` | 将用例 JSON 转换为可执行 pytest 脚本 |

`generate_pytest_script` 输出到 `API_TEST_DIR/test_{slug}.py`，包含：

- `api_session` fixture（requests Session）
- `_request` 辅助函数
- 按 tag 分组的参数化测试函数

### 6.5 `project_tools.py` — 项目元数据

| 工具 | 类型 | 用途 |
|------|------|------|
| `get_project` | async | 根据 project_id 从数据库读取项目配置 |
| `list_projects_tool` | async | 列出所有项目 |

让 Supervisor 和子 Agent 能把 `project_id` 解析为 `openapi_spec`、`base_url`、`repo_url` 等测试所需字段。

---

## 七、管理 API（api/main.py）

FastAPI 服务，端口 8100，与 Agent 共享同一套 `tools/` 实现，确保 REST 驱动和对话驱动的能力一致。

### REST 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/projects` | 项目列表 |
| POST | `/api/projects` | 创建项目 |
| GET | `/api/projects/{project_id}` | 项目详情 |
| GET | `/api/runs` | 测试运行列表 |
| GET | `/api/runs/{run_id}` | 运行详情 |
| GET | `/api/reports` | 报告列表 |
| GET | `/api/endpoints` | API 接口清单 |
| POST | `/api/endpoints/sync` | 解析 OpenAPI 并同步接口清单 |
| POST | `/api/analyze` | 触发代码影响分析 |
| POST | `/api/test` | 触发 API 测试执行 |

### 生命周期与数据库

```python
@asynccontextmanager
async def _lifespan(app: FastAPI):
    await init_db()
    yield
```

启动时自动建表（执行 `migrations/001_init.sql`），数据库不可用时接口会返回降级结果而不是直接崩溃。

---

## 八、数据库层（services/db.py + migrations/001_init.sql）

使用 `asyncpg` 连接 PostgreSQL，连接池为全局单例 `_pool`。

### 表结构

| 表 | 作用 | 关键字段 |
|----|------|---------|
| `projects` | 测试项目元数据 | `id`, `name`, `repo_url`, `openapi_spec`, `base_url` |
| `test_runs` | 测试执行记录 | `id`, `project_id`, `status`, `passed`, `failed`, `total` |
| `test_results` | 单次测试详情 | `run_id`, `test_name`, `status`, `endpoint`, `error_message` |
| `api_endpoints` | 接口清单 | `project_id`, `path`, `method`, `parameters`, `responses` |
| `reports` | 分析/测试报告 | `project_id`, `title`, `report_type`, `content` |

### 主要函数

- `init_db()`：创建连接池并执行迁移
- `create_test_run()` / `update_test_run()` / `save_test_result()`
- `get_recent_runs()` / `get_run_details()`

---

## 九、前端 UI（ui/）

基于 LangGraph Agent Chat UI 模板改造，使用 Next.js 15 + React 19 + Tailwind CSS 4 + Radix UI。

### 主要文件

| 文件 | 说明 |
|------|------|
| `src/app/page.tsx` | 聊天页面入口 |
| `src/app/admin/page.tsx` | 管理后台：项目、运行、报告、快捷操作 |
| `src/components/admin/project-form.tsx` | 新建项目表单 |
| `src/components/chat/QuickActions.tsx` | 聊天快捷按钮 + 项目选择器 |
| `src/components/chat/ChatInterface.tsx` | 聊天界面主体 |
| `src/lib/management-api.ts` | FastAPI 管理 API 客户端 |
| `src/providers/Stream.tsx` | LangGraph SSE 流连接与配置表单 |
| `src/app/api/[..._path]/route.ts` | Next.js API Passthrough 代理 |

### 关键流程

1. 用户访问 `/`，若未配置环境变量则弹出 LangGraph 连接表单
2. 通过 SSE 流与 Supervisor Agent 对话
3. `QuickActions` 加载项目列表，支持一键发送"变更影响分析""生成测试用例"等提示词
4. `/admin` 直接调用 FastAPI 管理 API，进行项目管理和触发操作

---

## 十、典型工作流

### 工作流 1：代码变更 → 智能回归测试

```
用户：分析最近的代码变更，确定需要回归测试的 API 接口
  → Supervisor → code-analyzer
  → code-analyzer 调用 codegraph_affected / explore / search
  → 输出受影响 API 列表 + 风险等级
  → Supervisor → api-tester 执行推荐测试
  → Supervisor → report-writer 生成回归测试报告
```

### 工作流 2：OpenAPI → 生成并执行测试

```
用户：基于 OpenAPI 生成并执行接口功能测试
  → Supervisor → test-generator
  → parse_openapi_spec → generate_api_test_cases → generate_pytest_script
  → Supervisor → api-tester 执行生成的脚本
  → Supervisor → report-writer 生成报告
```

### 工作流 3：契约测试

```
用户：验证 API 是否符合 OpenAPI 规范
  → Supervisor → api-tester
  → api-tester 调用 validate_api_contract（Schemathesis）
  → Supervisor → report-writer 生成契约合规报告
```

---

## 十一、测试与验证

### 平台自身测试

| 文件 | 内容 |
|------|------|
| `tests/test_platform.py` | 工具导入、Agent 配置、OpenAPI 解析、用例生成、脚本生成、Schema 校验 |
| `tests/test_pet_api.py` | Swagger Petstore 正向测试 |
| `tests/test_pet_api_negative.py` | Swagger Petstore 负向测试 |
| `tests/test_sample.py` | 早期生成的 Petstore 脚本示例 |

### pytest 配置

```ini
[pytest]
markers =
    smoke: 冒烟测试
    critical: 关键业务路径
    regression: 回归测试
    contract: API 契约测试
    slow: 慢速测试
testpaths = tests
addopts = -v --tb=short --strict-markers --color=yes
```

---

## 十二、已知问题

| 问题 | 位置 | 影响 | 建议 |
|------|------|------|------|
| 生成的 pytest 脚本使用 `body=null` | `tools/api_gen_tools.py` | 运行时报 `NameError: name 'null' is not defined` | 将 `null` 替换为 `None` |
| `requirements.txt` 中 `httpx` 重复 | `requirements.txt` | 不影响运行，但冗余 | 删除重复行 |
| 部分生成脚本未处理认证 | 生成的 `test_*.py` | 需要手动配置 token/cookie | 在 fixture 中补充实际认证逻辑 |

---

## 十三、关键依赖

### Python

- `deepagents`：多智能体编排框架
- `langgraph` / `langgraph-cli[inmem]`：LangGraph 服务
- `fastapi` / `uvicorn`：管理 API
- `asyncpg`：PostgreSQL 异步驱动
- `pytest` / `requests` / `httpx` / `schemathesis`：测试执行与契约测试
- `pyyaml` / `openapi-spec-validator` / `prance`：OpenAPI 解析

### Node.js

- `next` 15 + `react` 19：前端框架
- `@langchain/langgraph-sdk`：LangGraph 客户端
- `langgraph-nextjs-api-passthrough`：API 代理
- `pnpm` 10.5.1：包管理器

### 外部 CLI

- `codegraph`：代码智能分析
- `schemathesis`：契约测试

---

## 十四、总结

API Test Platform 采用 **"Supervisor + 4 个专业子 Agent"** 的多智能体架构，配合 **LangGraph API** 提供对话式交互，配合 **FastAPI** 提供管理 REST 接口，配合 **Next.js** 提供聊天与管理后台。工具层设计合理，Agent 与 REST API 复用同一套 `tools/` 代码，保持了能力一致性。

项目当前功能基本完整，但在 Docker 部署配置、生成脚本正确性、依赖冗余等方面仍需修复，详见[已知问题](#十二已知问题)。
