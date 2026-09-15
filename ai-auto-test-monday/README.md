# ai-auto-test-monday

Monday **Director 架构**的组件感知 Web UI 自动化测试平台。

- **Temporal** 编排 7 个 Agent（生成 + 执行）
- **Express API** `:3010` — 项目、启 pipeline、取消、查进度、读 artifact、WebSocket
- **Dashboard** `:8040` — 7 步进度、历史 Run、WS 实时更新、artifact 预览
- **Postgres** `ai_auto_test_monday`（宿主机 `:5433`）
- **Redis** — WebSocket 进度 pub/sub

与 [`ai-auto-test-platform`](../ai-auto-test-platform/) 的关系：Monday 负责 component-aware **生成**；Agent 7（Continuity Lead）可对接 platform 的 Pi/e2e-test-env **执行**，或在 platform 不可用时 **direct Playwright fallback**。

## 快速开始

### 1. 创建数据库

```sql
CREATE DATABASE ai_auto_test_monday;
```

### 2. Docker 一键启动

```bash
cd docker
cp .env.example .env
./start.sh
```

| 服务 | URL |
|------|-----|
| Dashboard | http://localhost:8040 |
| API health | http://localhost:3010/health |
| Temporal UI | http://localhost:8088 |

### 3. 启动 pipeline

```bash
curl -X POST http://localhost:3010/api/pipeline/run \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"demo","executeAfterGenerate":true,"executionMode":"auto"}'

curl http://localhost:3010/api/pipeline/runs/RUN_ID
curl -X POST http://localhost:3010/api/pipeline/runs/RUN_ID/cancel
curl "http://localhost:3010/api/pipeline/runs?projectId=demo"
```

## 目录

```
packages/agent-core/   共享类型、Scanner、Codemod、Agent 1–7
api/                   Express REST + WS
worker/                Temporal worker + activities
dashboard/             Vite/React 工作台
docker/                Compose、Dockerfile、skills、data/
docs/architecture.md   架构与里程碑
```

## 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| **M0–M1** | Docker、项目 CRUD、git clone / mount | ✅ |
| **M2** | Agent 1–4：多框架扫描 + LLM | ✅ |
| **M3** | Agent 5–6：journeys + Playwright spec | ✅ |
| **M4** | Dashboard Gherkin 卡片、artifact 预览 | ✅ |
| **v2** | Agent 7 Continuity Lead + platform/direct 执行 | ✅ |
| **v2.1** | Type B 自动重跑 Agent 1–6 子集 | 待做 |

Skill 文档：`docker/skills/component-aware-web-automation/SKILL.md`

## Dashboard 功能

- WebSocket 实时 agent 进度（fallback 2s 轮询）
- 历史 Run 列表（`GET /api/pipeline/runs?projectId=`）
- 流水线取消（`POST /api/pipeline/runs/:runId/cancel`）
- 可选「注入 testid」「生成后执行」、execution mode（auto/platform/direct）
- URL 深链 `?runId=` 刷新不丢上下文

## Stage Manager Apply

默认 **dry-run**。勾选「注入 testid」后 Stage Manager 会对 React/Vue/Angular/Svelte 源码 apply `data-testid`（worker 对 sandbox 卷 rw 挂载）。

## Agent 7 执行

1. materialize artifact → `tests/e2e/` + `tests/e2e/poms/`
2. **platform**（auto 优先）：register → import features → `POST /api/run` 逐 journey
3. **direct fallback**：worker 内 subprocess 跑 Playwright

环境变量见 `docker/.env.example`（`PLATFORM_BASE_URL`、`EXECUTION_MODE` 等）。
