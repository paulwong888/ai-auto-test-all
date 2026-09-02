# API Test Platform — 本地运行环境安装及部署文档

> 项目路径：`api-test-platform-python/`  
> 文档生成日期：2026-07-17  
> 配套文档：[代码解读文档](code-analysis.md)

---

## 目录

1. [环境要求](#一环境要求)
2. [安装步骤](#二安装步骤)
3. [环境变量配置](#三环境变量配置)
4. [启动依赖服务](#四启动依赖服务)
5. [启动后端服务](#五启动后端服务)
6. [启动前端](#六启动前端)
7. [管理后台使用](#七管理后台使用)
8. [验证核心功能](#八验证核心功能)
9. [Docker Compose 部署](#九docker-compose-一键部署待完善)
10. [常见问题排查](#十常见问题排查)
11. [推荐启动顺序](#十一推荐本地开发启动顺序)
12. [生产部署建议](#十二生产部署建议)

---

## 一、环境要求

### 1.1 基础环境

| 组件 | 推荐版本 | 说明 |
|------|---------|------|
| 操作系统 | Windows 11 / macOS / Linux | Windows 开发已验证 |
| Python | 3.13+ | `pyproject.toml` 要求 `>=3.13` |
| Node.js | 22.x LTS | 前端与 CodeGraph CLI 依赖 |
| pnpm | 10.5.1+ | 前端包管理器（项目锁定） |
| PostgreSQL | 16+ | 数据持久化 |
| Redis | 7+ | 会话/缓存 |
| Git | 任意 | 代码变更分析需要 |

### 1.2 外部服务

- **LLM API**：项目使用 OpenAI 兼容接口，默认示例为 DeepSeek
  - 地址：`https://api.deepseek.com/v1`
  - 需准备 API Key
- **CodeGraph CLI**：用于代码影响分析
  - 安装命令：`npm install -g codegraph`

---

## 二、安装步骤

### 2.1 进入项目目录

```bash
cd c:\Users\65132\Desktop\1\api-test-platform
```

### 2.2 安装 Python 依赖

项目同时提供 `requirements.txt` 和 `pyproject.toml` + `uv.lock`，推荐使用 `uv`：

```bash
# 推荐：使用 uv（与 uv.lock 对齐）
uv sync

# 备选：使用 pip
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

> 提示：`requirements.txt` 中 `httpx` 重复出现两次，建议删除重复行。

### 2.3 安装 CodeGraph CLI

```bash
npm install -g codegraph
codegraph --version
```

### 2.4 安装前端依赖

```bash
cd ui
pnpm install
```

---

## 三、环境变量配置

### 3.1 后端 `docker/.env`

```bash
cd docker
cp .env.example .env
```

本地 `langgraph dev` 时，在 `backend/` 下链接：

```bash
cd backend
ln -sf ../docker/.env .env
```

最小可用 Docker 配置示例见 [`docker/.env.example`](../docker/.env.example)（Higress + 外部 Postgres 5433）。

### 3.2 前端 `ui/.env`

```bash
cd ui
cp .env.example .env
```

```ini
NEXT_PUBLIC_API_URL=http://localhost:8200
NEXT_PUBLIC_ASSISTANT_ID=api-test-platform
NEXT_PUBLIC_AUTH_SCHEME=
LANGSMITH_API_KEY=
NEXT_PUBLIC_MANAGEMENT_API_URL=http://localhost:8100
```

> `NEXT_PUBLIC_ASSISTANT_ID` 必须与 `langgraph.json` 中的 graph name 一致（`api-test-platform`）。

---

## 四、启动依赖服务

### 方式一：Docker Compose（推荐）

```bash
cd docker
cp .env.example .env   # 首次
./start.sh
```

运维：`./restart.sh` · `./shutdown.sh` · `./logs.sh [ui|api|langgraph|redis]`

### 方式二：手动安装

- 安装 PostgreSQL 16，创建数据库 `api_test_platform`
- 安装 Redis 7 并启动
- 确认 `.env` 中数据库连接信息正确

---

## 五、启动后端服务

### 5.1 启动 LangGraph API 服务

```bash
cd backend
# source .venv/bin/activate  # 若使用 venv
langgraph dev --host 0.0.0.0 --port 8200 --n-jobs-per-worker 10
```

验证：

- API：`http://localhost:8200`
- 状态页：`http://localhost:8200/info`

### 5.2 启动 FastAPI 管理 API

新终端：

```bash
cd backend
# source .venv/bin/activate
python -m uvicorn api.main:app --host 0.0.0.0 --port 8100 --reload
```

访问：

- 服务：`http://localhost:8100`
- 文档：`http://localhost:8100/docs`
- 健康检查：`http://localhost:8100/health`

---

## 六、启动前端

```bash
cd ui
pnpm dev
```

访问：`http://localhost:3000`

首次打开时若未配置环境变量，会弹出表单要求输入：

- **Deployment URL**：`http://localhost:8200`
- **Assistant / Graph ID**：`api-test-platform`
- **API Key**：本地运行可不填

---

## 七、管理后台使用

访问：`http://localhost:3000/admin`

### 7.1 新建项目

点击"新建项目"，填写：

- **项目名称**（必填）
- **API Base URL**：被测 API 根地址
- **代码仓库路径**：本地路径或 git URL
- **OpenAPI 规范路径**：`swagger.json` 本地路径或远程 URL
- **描述**（可选）

### 7.2 项目卡片操作

| 按钮 | 调用接口 | 作用 |
|------|---------|------|
| 分析 | `POST /api/analyze` | 代码变更影响分析 |
| 测试 | `POST /api/test` | 运行 `marker=smoke` 的冒烟测试 |
| 同步 | `POST /api/endpoints/sync` | 解析 OpenAPI 并同步接口清单 |

---

## 八、验证核心功能

### 8.1 健康检查

```bash
curl http://localhost:8100/health
```

### 8.2 创建测试项目

```bash
curl -X POST http://localhost:8100/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Petstore Demo",
    "base_url": "https://petstore.swagger.io/v2",
    "openapi_spec": "workspace/api-test-platform/swagger.json"
  }'
```

### 8.3 同步接口清单

```bash
curl -X POST http://localhost:8100/api/endpoints/sync \
  -H "Content-Type: application/json" \
  -d '{"project_id": "上一步返回的项目ID"}'
```

### 8.4 运行平台自身测试

```bash
cd c:\Users\65132\Desktop\1\api-test-platform
.venv\Scripts\activate
pytest
```

### 8.5 运行 Petstore 测试

```bash
pytest tests/test_pet_api.py -v
```

> 注意：当前 `tools/api_gen_tools.py` 生成的脚本中可能包含 `body=null`，运行前请改为 `body=None`。

---

## 九、Docker Compose 一键部署

### 9.1 目录与脚本

| 路径 | 说明 |
|------|------|
| `docker/docker-compose.yml` | 服务编排（ui / api / langgraph / redis） |
| `docker/langgraph/Dockerfile` | LangGraph 镜像 |
| `docker/api/Dockerfile` | FastAPI 镜像 |
| `docker/ui/Dockerfile` | Next.js 镜像 |
| `docker/start.sh` | 构建并启动 |
| `docker/.env.example` | 环境变量模板 |

### 9.2 启动

```bash
cd docker
cp .env.example .env
./start.sh
```

### 9.3 服务端口（Docker 默认）

| 服务 | 端口 |
|------|------|
| UI | 8038 |
| LangGraph | 8200 |
| FastAPI | 8100 |
| PostgreSQL | 5433（外部实例） |
| Redis | 6379（Compose 内部，不映射宿主机） |

---

## 十、常见问题排查

### 10.1 LangGraph 启动失败：找不到 `agent:graph`

确认 `langgraph.json`：

```json
{
  "dependencies": ["."],
  "graphs": {
    "api-test-platform": "agent:graph"
  },
  "env": ".env"
}
```

### 10.2 数据库连接失败

- 检查 PostgreSQL 是否已启动
- 检查 `.env` 中 `POSTGRES_*` 配置
- 确认数据库 `api_test_platform` 已创建

### 10.3 Windows 下 Agent 命令乱码或崩溃

`agent.py` 已对 `LocalShellBackend.execute` 做了 UTF-8 补丁。如仍有问题：

```powershell
chcp 65001
```

### 10.4 CodeGraph 未找到

```bash
npm install -g codegraph
```

并确认 `CODEGRAPH_PATH` 指向正确的可执行文件。

### 10.5 前端无法连接 LangGraph

- 检查 `ui/.env` 中 `NEXT_PUBLIC_API_URL` 是否为 `http://localhost:8200`
- 检查 `NEXT_PUBLIC_ASSISTANT_ID` 是否为 `api-test-platform`
- 检查浏览器控制台网络请求与跨域配置

---

## 十一、推荐本地开发启动顺序

```bash
# 方式 A：Docker 一键启动（推荐）
cd docker && ./start.sh

# 方式 B：本地多终端开发
# 终端 1：LangGraph
cd backend && langgraph dev --host 0.0.0.0 --port 8200 --n-jobs-per-worker 10

# 终端 2：FastAPI
cd backend && python -m uvicorn api.main:app --host 0.0.0.0 --port 8100 --reload

# 终端 3：前端
cd ui && pnpm dev
```

全部启动后：

- 聊天界面：`http://localhost:3000`
- 管理后台：`http://localhost:3000/admin`
- LangGraph API：`http://localhost:8200`
- FastAPI 文档：`http://localhost:8100/docs`

---

## 十二、生产部署建议

1. **不要直接暴露 LangGraph**：使用 Next.js API Passthrough 或 Nginx 反向代理，统一走 `3000` 端口
2. **API Key 管理**：生产环境使用 `LANGSMITH_API_KEY` 或自定义鉴权，不要在前端暴露密钥
3. **数据库持久化**：Docker 部署时使用命名卷 `pgdata` 持久化 PostgreSQL 数据
4. **日志与监控**：为 FastAPI 和 LangGraph 配置结构化日志
5. **CodeGraph 路径**：Docker 中挂载 `/workspace`，设置 `CODEGRAPH_DEFAULT_PROJECT=/workspace`
6. **前端构建变量**：Docker 构建时传入所有 `NEXT_PUBLIC_*` 变量，避免运行时失效
