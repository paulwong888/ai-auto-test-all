# ai-auto-test-playwright — Agent 开发指南

> 供 Cursor / 开发 Agent 在本 monorepo 内实施平台代码时使用。被测项目的 Pi 行为准则见 [`templates/project-scaffold/.pi/AGENTS.md`](templates/project-scaffold/.pi/AGENTS.md)。

## 1. 项目定位

构建 **Web 化 Playwright pytest E2E 自动化平台**，将仓库内已验证的 Skills 工作流平台化：

```
上传录制 → AI 生成用例计划 → 人工确认 → 生成 POM 代码 → Worker 执行 → HTML 报告 → fix 分析
```

| 维度 | ai-auto-test-platform | 本项目 |
|------|----------------------|--------|
| 测试语言 | TypeScript | **Python** |
| 测试框架 | Playwright Test CLI | **pytest-playwright** |
| 用例来源 | BDD Gherkin | **Codegen 录制 + AI 计划** |
| Agent Skills | e2e-test-env | **playwright-codegen / run-report / fix** |

**仓库外参考资产：**

- 样例工程：[`../tests/`](../tests/)（Sauce Demo 15 用例）
- Skills：[`../skills/playwright-e2e/cn/`](../skills/playwright-e2e/cn/)
- 平台参考：[`../ai-auto-test-platform/test-server/`](../ai-auto-test-platform/test-server/)

---

## 2. 文档索引（实施前必读）

| 文档 | 内容 |
|------|------|
| [PRD.md](./PRD.md) | MVP 产品需求、API、数据模型、验收标准 |
| [PRD-MVP-Implementation.md](./PRD-MVP-Implementation.md) | M1–M4 里程碑、**完成状态与实现差异** |
| [PRD-Phase2.md](./PRD-Phase2.md) | 计划编辑、fix/apply、CI preset |
| [PRD-Phase2-Implementation.md](./PRD-Phase2-Implementation.md) | Phase 2 实施拆解 |
| [PRD-Phase3.md](./PRD-Phase3.md) | 队列、Web 录制、Git、RBAC |
| [PRD-Phase3-Implementation.md](./PRD-Phase3-Implementation.md) | Phase 3 实施拆解 |

**当前阶段：Phase 2 + Phase 3 全量已完成（v1.0.0）** — fix apply 闭环、run preset/compare、Redis 队列、noVNC 录制、Git、CI token、邮箱登录 RBAC。

**默认 demo：** `AUTH_DISABLED=true`（docker `.env`），生产需启用 JWT + 项目成员。

---

## 3. Monorepo 目标结构

```
ai-auto-test-playwright/
├── AGENT.md                 # 本文件
├── PRD*.md
├── package.json             # npm workspaces: server + dashboard
├── docker/                  # compose + Dockerfile
├── server/                  # Express 5 + TypeScript API
├── dashboard/               # Vite + React（:8041）
├── worker/                  # Python pytest Worker
├── templates/project-scaffold/
├── docker/skills/           # Pi skills（codegen / run-report / fix）
└── scripts/demo-saucedemo.sh
```

---

## 4. 实施顺序（严格遵守，不可跳步）

| 里程碑 | 核心交付 | 状态 |
|--------|----------|------|
| **M1** | monorepo、postgres、projects CRUD、`/health`、scaffold 模板 | **已完成** |
| **M2** | init-template、record/upload、Pi plan/code、jobs API | **已完成** |
| **M3** | Python Worker、`/opt/venv/bin/pytest`、run/report、WebSocket | **已完成** |
| **M4** | Dashboard 7 页、fix/analyze、demo 脚本 | **已完成** |
| **Phase 2 P2-M1** | 计划版本（编辑、diff、planVersionId codegen） | **已完成** |
| **Phase 2 P2-M2** | fix apply/verify 闭环 + FixReview UI | **已完成** |
| **Phase 2 P2-M3** | run preset、rerunFailedOnly、TC 选择 | **已完成** |
| **Phase 2 P2-M4** | run compare、trend、History 页 | **已完成** |
| **Phase 3 P3-M1** | Redis/BullMQ + 多 project 并行 run | **已完成** |
| **Phase 3 P3-M2** | noVNC Web 录制 | **已完成** |
| **Phase 3 P3-M3** | Git bind/push/PR | **已完成** |
| **Phase 3 P3-M4** | CI webhook + GitHub Action | **已完成** |
| **Phase 3 P3-M5** | 邮箱登录 + RBAC + audit | **已完成** |

---

## 5. MVP 已建模块清单

以下模块 **已存在**，Agent 勿重复创建：

| 模块 | 路径 |
|------|------|
| pytest 命令构建 | `server/src/services/pytest-runner.ts` |
| Plan 编排 | `server/src/services/plan-service.ts` |
| Code 编排 | `server/src/services/codegen-service.ts` |
| Fix 编排 | `server/src/services/fix-service.ts` |
| Run 编排 | `server/src/services/run-service.ts` |
| Workflow | `server/src/services/workflow-service.ts` |
| Jobs CRUD | `server/src/repositories/job-repository.ts` |
| Fix 持久化 | `server/src/repositories/fix-suggestion-repository.ts` |
| Worker HTTP | `worker/server.py` |
| Dashboard | `dashboard/src/`（7 页面 + hooks） |
| Demo 脚本 | `scripts/demo-saucedemo.sh` |

**从 platform 复用（已落地）：** `server/src/pi/*`、`server/src/ws/ws-hub.ts`、`project-template-service.ts`

**API 响应格式（与 platform 不同）：**

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "INVALID_WORKSPACE", "message": "..." } }
```

**字段命名：** `workspacePath`、`baseUrl`（不用 platform 的 `repoPath`、`targetUrl`）。

---

## 6. 关键 ADR（不可违反）

| ID | 决策 |
|----|------|
| ADR-007 | MVP 必须有 `jobs` 表（plan/code/fix/run） |
| ADR-008 | Worker 使用镜像内 `/opt/venv/bin/pytest`，**不依赖** workspace `.venv` |
| ADR-009 | MVP 每项目**单 module**；多模块请拆项目 |
| ADR-P3-008 | Phase 3：BullMQ 在 **Node** 消费，Python Worker 仍走 HTTP |

---

## 7. 编码原则

1. **最小 diff** — 只改当前里程碑相关文件，不顺手重构
2. **对齐 platform 风格** — Express 5、TypeScript、`zod` 校验、ESM（`"type": "module"`）
3. **不提交敏感/产物** — `.env`、`auth.json`、`report.html`、`test-results/`
4. **路径沙箱** — `workspacePath` 必须在 `ALLOWED_REPO_PREFIXES` 白名单内
5. **中文注释** — 仅在非显而易见处使用；代码标识符用英文

---

## 8. MVP 验收命令

```bash
cd docker && docker-compose up --build -d
# 部分环境请用 docker compose up --build -d

curl http://localhost:8041/health
# → server/database/worker: up

open http://localhost:8041/projects

# 全链路 demo（无 Pi 时预置 tests/）
SEED_TESTS=always MODE=ci ../scripts/demo-saucedemo.sh
```

对照 [PRD.md 第 9 章](./PRD.md#9-mvp-验收标准) 与 [PRD-MVP-Implementation.md §7 实现差异](./PRD-MVP-Implementation.md#7-mvp-完成说明--实现差异)。

---

## 9. 本地开发（不用 Docker）

```bash
npm install
npm run dev -w server          # API :3002
npm run dev:dashboard          # UI :8041（代理 /api /ws → 3002）
```

Server 环境：`cd server && cp ../docker/.env.example .env`，设置 `POSTGRES_HOST=localhost`、`POSTGRES_PORT=5434`。

---

## 10. 已知限制（Agent 勿误判为 bug）

1. **Headed / SlowMo** — Run 在 Worker 容器内通过 **Xvfb** 执行；勾选 Headed **不会在用户桌面弹浏览器**。要本地看浏览器请在 workspace 内直接 `pytest --headed`。
2. **录制** — MVP 仅 **本地上传** `.py`；Web 内 codegen / noVNC 属 **Phase 3**。
3. **单 module** — 每项目一个 `moduleName`；多模块请拆多个项目（ADR-009）。
4. **Run 状态更新偏慢** — pytest 本身 ~45s，但 Worker NDJSON 流关闭慢导致 DB 状态延迟；server 已从 log 行 fallback 解析 passed/failed。
5. **Pi 依赖** — plan/code/fix 需 `docker/.env.local` 中 `DASHSCOPE_API_KEY`；无 Key 时用 `SEED_TESTS=always` demo 跳过 AI 步骤。
6. **UI polish 未完成** — Record 页缺 codegen 命令复制区；Tab 未按 workflow stage 禁用（见 Implementation §7）。
