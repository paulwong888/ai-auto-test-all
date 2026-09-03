# ai-auto-test-monday

Monday **Director 架构**的组件感知 Web UI 自动化测试平台（M0 脚手架）。

- **Temporal** 编排 6 个 MVP Agent（M0 为 stub，写占位 artifact）
- **Express API** `:3010` — 项目、启 pipeline、查进度、读 artifact
- **Dashboard** `:8040` — 7 步进度 + artifact 预览
- **Postgres** `ai_auto_test_monday`（宿主机 `:5433`）
- **Redis** — WebSocket 进度 pub/sub

与 [`ai-auto-test-platform`](../ai-auto-test-platform/) 的关系：platform 负责 Pi/Gherkin **执行**；monday 负责 component-aware **生成**流水线（artifact → Playwright spec）。

## 快速开始

### 1. 创建数据库

在宿主机 Postgres（默认 `localhost:5433`）上：

```sql
CREATE DATABASE ai_auto_test_monday;
```

### 2. Docker 一键启动

```bash
cd docker
cp .env.example .env   # 按需修改 POSTGRES_*、EXTERNAL_REPOS_HOST_PATH
./start.sh
```

| 服务 | URL |
|------|-----|
| Dashboard | http://localhost:8040 |
| API health | http://localhost:3010/health |
| Temporal UI | http://localhost:8088 |

### 3. 跑通 stub pipeline

```bash
curl -X POST http://localhost:3010/api/pipeline/run \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"demo"}'

# 查进度（替换 RUN_ID）
curl http://localhost:3010/api/pipeline/runs/RUN_ID

# 检查 artifact
ls docker/data/artifacts/demo/<runId>/
```

## 本地开发（无 Docker）

```bash
npm install
npm run build

# 终端 1 — 需 Temporal + Redis + Postgres
npm run dev:api

# 终端 2
npm run dev:worker

# 终端 3
npm run dev:dashboard
```

环境变量见 `docker/.env.example`。

## 目录

```
packages/agent-core/   共享类型、Temporal 常量、artifact 路径
api/                   Express REST + WS
worker/                Temporal worker + 6 stub activities
dashboard/             Vite/React 工作台
docker/                Compose、Dockerfile、skills、data/
docs/architecture.md   架构与里程碑
```

## 里程碑

| 阶段 | 内容 |
|------|------|
| **M0** | 本仓库：stub pipeline + Docker + Dashboard |
| **M1** | 项目 CRUD、git clone（SSH）、clone 状态、路径校验 |
| **M2** | Agent 1–4：React 扫描 + Higress LLM、真实 artifact |
| M3 | Agent 5–6：journeys + Playwright spec |
| M4 | Dashboard Gherkin 卡片、artifact 增强 |
| v2 | Continuity Lead + Pi/e2e-test-env 执行 |

Skill 文档：`docker/skills/component-aware-web-automation/SKILL.md`

## M1 验证（项目 Clone）

```bash
# CRM mount 型 — 应已为 ready
curl http://localhost:3010/api/projects/crm-front

# 手动 clone（mount 或 git）
curl -X POST http://localhost:3010/api/projects/crm-front/clone
# 轮询 GET /api/projects/crm-front 直到 cloneStatus=ready

# Pipeline 需 ready 后才能启动
curl -X POST http://localhost:3010/api/pipeline/run \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"crm-front"}'
# component-registry.json 中 frontendPath 应为 CRM 目录
```

Dashboard：http://localhost:8040 — 「项目管理」面板可 CRUD + Clone；Clone 完成后再点「启动 Director 流水线」。

## M2 验证（Agent 1–4）

```bash
docker compose up -d --build worker api dashboard
curl -X POST http://localhost:3010/api/pipeline/run \
  -H 'Content-Type: application/json' -d '{"projectId":"crm-front"}'
# 完成后检查 component-registry.json 组件数 > 0，且非 StubComponent
```
