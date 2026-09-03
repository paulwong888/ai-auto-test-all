# API Test Platform — 企业级智能接口自动化测试平台

基于 **DeepAgents** 多智能体架构 + **CodeGraph** 代码智能 + **LangGraph API** 的企业级 API 智能测试平台。

---

## 核心能力

| 能力 | 实现 | 说明 |
|------|------|------|
| 代码变更影响分析 | CodeGraph (30+ 语言, 17 框架) | 代码变更 → API 路由影响 → 回归测试范围 |
| 智能测试生成 | OpenAPI/Swagger 解析 | 自动生成正向/负向/边界测试用例和 pytest 脚本 |
| 测试执行引擎 | pytest + requests/httpx | 冒烟/回归/契约/并行测试 |
| 报告生成 | 结构化 Markdown | 通过率、失败分析、性能数据、改进建议 |
| 多智能体协同 | DeepAgents | 4 个子智能体自主协作 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│  DeepAgents UI (Next.js 15 + React 19)  :3000               │
│  ├── /          → React Chat Interface (SSE 流式)           │
│  └── /admin     → 项目管理 / 运行历史 / 报告                 │
├─────────────────────────────────────────────────────────────┤
│  LangGraph API Server (:8200 或默认 2024)                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Supervisor (主编排器)                         │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │   │
│  │  │  code-   │ │   api-   │ │  test-   │ │ report  │ │   │
│  │  │ analyzer │ │  tester  │ │ generator│ │ writer  │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  FastAPI Management API (:8100)                             │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL (:5432)  •  Redis (:6379)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 智能体框架 | DeepAgents | 多智能体编排，子智能体隔离 |
| 对话后端 | LangGraph API | SSE 流式响应，内存持久化 |
| 代码智能 | CodeGraph | MIT 协议，30+ 语言，17 框架路由 |
| 测试引擎 | pytest + requests | 行业标准 API 测试框架 |
| 契约测试 | Schemathesis | 自动 OpenAPI 合规验证 |
| 前端 | Next.js 15 + React 19 | DeepAgents UI 聊天界面 |
| 数据库 | PostgreSQL 16 | 测试结果持久化 |
| 缓存 | Redis 7 | 会话缓存 |
| 部署 | Docker Compose | 服务一键部署 |

---

## 快速开始

### 环境要求

- Python **3.13+**（`pyproject.toml` 要求）
- Node.js **22.x LTS**
- pnpm **10.5.1+**
- PostgreSQL 16+
- Redis 7+
- 一个 OpenAI 兼容的 LLM API Key（默认示例为 DeepSeek）

### 1. 安装依赖

```bash
cd api-test-platform-python

# Python 依赖（推荐 uv，与 uv.lock 对齐）
cd backend && uv sync

# 或 pip
# python -m venv .venv
# source .venv/bin/activate
# pip install -r requirements.txt

# CodeGraph CLI（代码分析必需）
npm install -g codegraph

# 前端依赖
cd ../ui
pnpm install
```

### 2. 配置环境变量

```bash
# Docker / 后端配置
cd docker
cp .env.example .env
# 编辑 .env 填入 OPENAI_API_KEY、数据库连接等

# 本地 langgraph dev：在 backend/ 下链接 env
cd ../backend
ln -sf ../docker/.env .env

# 前端配置（本地 pnpm dev）
cd ../ui
cp .env.example .env
# 编辑 .env 填入 NEXT_PUBLIC_API_URL、NEXT_PUBLIC_ASSISTANT_ID 等
```

`.env` 关键字段说明：

| 变量 | 说明 | 本地开发建议值 |
|------|------|---------------|
| `OPENAI_API_KEY` | LLM API Key | `sk-xxx` |
| `OPENAI_BASE_URL` | OpenAI 兼容接口地址 | `http://host.docker.internal:8004/v1`（Higress → NPU） |
| `MODEL_PROVIDER` | 模型 provider | `openai` |
| `MODEL_NAME` | 模型名称 | `ds-v4-flash-0731-dspark`（NPU DeepSeek V4） |
| `LLM_TIMEOUT` | LLM 请求总超时（秒） | `600` |
| `LLM_STREAM_CHUNK_TIMEOUT` | 流式 chunk 间隔超时（秒） | `600` |
| `LLM_MAX_RETRIES` | LLM 失败重试次数 | `3` |
| `LLM_USE_RESPONSES_API` | 是否使用 `/v1/responses` | `true` |
| `BACKEND_ROOT_DIR` | Agent 可访问的工作根目录 | 项目绝对路径 |
| `CODEGRAPH_DEFAULT_PROJECT` | CodeGraph 分析目标路径 | 项目绝对路径 |
| `POSTGRES_*` | PostgreSQL 连接信息 | 见 `docker/.env.example` |
| `REDIS_*` | Redis 连接信息 | 见 `docker/.env.example` |

`ui/.env` 关键字段：

| 变量 | 说明 | 本地开发建议值 |
|------|------|---------------|
| `NEXT_PUBLIC_API_URL` | LangGraph 服务地址 | `http://localhost:8200` |
| `NEXT_PUBLIC_ASSISTANT_ID` | Graph / Assistant ID | `api-test-platform` |
| `NEXT_PUBLIC_MANAGEMENT_API_URL` | FastAPI 管理后台地址 | `http://localhost:8100` |

### 3. 本地开发启动

```bash
# 启动 LangGraph API（在 backend/ 目录）
cd backend
langgraph dev --host 0.0.0.0 --port 8200 --n-jobs-per-worker 10

# 启动 FastAPI 管理 API（另开终端）
cd backend
python -m uvicorn api.main:app --host 0.0.0.0 --port 8100 --reload

# 启动前端（另开终端）
cd ui
pnpm dev
```

访问：

- 聊天界面：`http://localhost:3000`
- 管理后台：`http://localhost:3000/admin`
- LangGraph API：`http://localhost:8200`
- FastAPI 文档：`http://localhost:8100/docs`

### 4. Docker Compose 一键部署（推荐）

```bash
cd docker
cp .env.example .env   # 首次运行
./start.sh
```

访问（默认端口）：

- UI：`http://localhost:8038`
- Admin：`http://localhost:8038/admin`
- FastAPI：`http://localhost:8100`
- LangGraph：`http://localhost:8200`

运维脚本：

| 脚本 | 说明 |
|------|------|
| `./start.sh` | 构建并启动全部服务 |
| `./restart.sh` | 重启 |
| `./shutdown.sh` | 停止 |
| `./logs.sh [service]` | 查看日志（ui / api / langgraph / redis） |

---

## 项目结构

```
api-test-platform-python/
├── backend/                  # Python 后端（LangGraph + FastAPI）
│   ├── agent.py              # Supervisor 主编排器 (4 子智能体)
│   ├── langgraph.json        # LangGraph API 配置
│   ├── requirements.txt      # Python 依赖（pip）
│   ├── pyproject.toml        # Python 项目配置（uv）
│   ├── uv.lock
│   ├── pytest.ini
│   ├── tools/                # 12 个工具
│   ├── agents/               # 4 个子智能体定义
│   ├── services/db.py        # PostgreSQL CRUD
│   ├── api/main.py           # FastAPI 管理 API
│   ├── migrations/001_init.sql
│   └── workspace/            # 运行时生成（test_suites 等）
│
├── ui/                       # Next.js 前端
│   ├── src/app/page.tsx      # 聊天界面
│   ├── src/app/admin/page.tsx# 管理后台
│   └── package.json
│
├── docker/                   # Docker 与运维脚本
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── start.sh / restart.sh / shutdown.sh / logs.sh
│   ├── langgraph/Dockerfile
│   ├── api/Dockerfile
│   └── ui/Dockerfile
│
└── docs/                     # 项目文档
    ├── code-analysis.md
    └── deployment.md
```

---

## 典型工作流

### 工作流 1：代码变更 → 智能回归测试

```
用户："分析最近的代码变更，确定需要回归测试的 API 接口"
  → code-analyzer: codegraph_affected → 受影响的 API 路由
  → code-analyzer: codegraph_explore → 路由调用链分析
  → code-analyzer: 输出回归测试推荐（优先级 + 理由）
  → api-tester: 执行推荐的回归测试
  → report-writer: 生成回归测试报告
```

### 工作流 2：从 OpenAPI 生成并执行测试

```
用户："从 swagger.json 生成测试用例并执行"
  → test-generator: parse_openapi_spec → 接口清单
  → test-generator: generate_api_test_cases → 结构化用例
  → test-generator: generate_pytest_script → 可执行脚本
  → api-tester: run_api_tests → 执行测试
  → report-writer: 生成测试报告
```

### 工作流 3：契约测试

```
用户："验证 API 是否符合 OpenAPI 规范"
  → api-tester: validate_api_contract → Schemathesis 自动测试
  → report-writer: 生成契约合规报告
```

---

## 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Next.js UI | 3000（本地 dev）/ 8038（Docker） | 聊天界面与管理后台 |
| LangGraph API | 8200 | 智能体对话服务 |
| FastAPI | 8100 | 管理 API |
| PostgreSQL | 5433（外部实例） | 数据持久化 |
| Redis | 6379（Compose 内部） | 缓存/会话 |

---

## 测试

```bash
cd backend
pytest
```

---

## 已知问题

| 问题 | 说明 | 临时处理 |
|------|------|---------|
| 生成脚本中出现 `body=null` | Python 中 `null` 不合法 | 运行前将生成文件中的 `null` 替换为 `None` |
| `requirements.txt` 中 `httpx` 重复 | 不影响安装 | 可删除重复行 |

---

## 文档

- [代码解读文档](docs/code-analysis.md)
- [本地运行环境安装及部署文档](docs/deployment.md)

---


