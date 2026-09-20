# 验收真值表（Wave 0 基线）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-19 |
| 环境 | `docker/docker-compose.yml`，`AUTH_DISABLED=true` |
| 执行者 | Wave 0 自动化 + 手工 curl 补充 |

**图例：** ✅ 通过 · ❌ 失败 · ⚠️ 降级/部分 · ⏭️ 未测 · 🔧 Wave 1 待修

---

## 环境预检

| 检查项 | 结果 | 证据 |
|--------|------|------|
| postgres healthy | ✅ | `docker-compose ps` |
| redis up | ✅ | 端口 6379 |
| server healthy | ✅ | `GET /health` → `ok: true` |
| worker healthy | ✅ | health 中 `worker: up` |
| dashboard | ✅ | `http://localhost:8040` → 200 |
| recorder 镜像 | ✅ | Wave 2：`docker build -f docker/recorder/Dockerfile -t ai-auto-test-playwright-recorder:latest .` |
| demo-saucedemo.sh (ci) | ✅ | 102s，15 passed |
| demo-saucedemo.sh (debug) | ✅ | 137s，15 passed |
| demo-phase2.sh | ✅ | Wave 1 全量验收，退出码 0，~6min（CI ~91s） |
| demo-git-ci.sh | ✅ | Wave 3：SSH push + webhook CI + token scope，~2min |
| demo-rbac.sh | ✅ | Wave 4：AUTH on，viewer 403 / editor 202 / audit |
| demo-phase3.sh | ✅ | Wave 3：含 git-ci + recording 回归 |

---

## MVP — [PRD.md §9](PRD.md)（9 条）

| # | 验收项 | 结果 | 证据 / 备注 |
|---|--------|------|-------------|
| 1 | 四服务 healthy | ✅ | 含 redis；worker 单实例 |
| 2 | Web 创建项目 | ✅ | demo `POST /api/projects` |
| 3 | init-template | ✅ | demo 步骤 2 |
| 4 | 上传 recorded.py | ✅ | demo 步骤 3 |
| 5 | Pi 生成计划 + UI 展示 | ⚠️ | `SEED_TESTS=always` 跳过 Pi；需 API Key 单独验 |
| 6 | 确认后 Pi 生成 POM 代码 | ⚠️ | 同上 seed 降级 |
| 7 | headed slowmo 15 passed | ✅ | `MODE=debug` demo，容器内 Xvfb（非宿主机弹窗） |
| 8 | UI 打开 HTML 报告 | ✅ | `GET .../runs/:id/report` 200；ReportPage 未目视 |
| 9 | fix/analyze 结构化建议 | ⏭️ | 全绿 run 跳过；需故意失败 run + Pi Key |

**MVP 小结：** 核心链路（上传→run→报告）✅；Pi/fix 项需 Wave 1 补测。

---

## Phase 2 — [PRD-Phase2.md §7](PRD-Phase2.md)（10 条）

| # | 验收项 | 结果 | 证据 / 备注 |
|---|--------|------|-------------|
| 1 | 编辑 plan 保存 v2，diff v1 vs v2 | ✅ | demo：v1 PUT → v2 PUT + `baseVersionId` → `GET plan/diff` 含 TC-016 |
| 2 | 基于 v2 重新 code/generate | ⏭️ | 未测（需 Pi 或 seed + planVersionId） |
| 3 | 失败 → analyze 返回 patches + Diff | ⚠️ | demo 用 psql seed `fix_suggestions`（非 Pi analyze）；patches 结构 OK |
| 4 | apply patch → verify 单用例通过 | ✅ | demo：`fix/apply` + `autoVerify` → verify run 1 passed |
| 5 | 第 4 轮 fix → 422 FIX_ITERATION_LIMIT | ✅ | demo：insert iterations 2,3 → apply 422 `FIX_ITERATION_LIMIT` |
| 6 | ci preset 15 用例 < 3min | ✅ | demo ~91s，15 passed |
| 7 | debug preset 与 MVP 一致 | ✅ | debug demo 137s，15 passed |
| 8 | rerunFailedOnly 仅重跑失败用例 | ✅ | demo：break TC-001 后 rerun total=1（仍 failed，符合预期） |
| 9 | 两次 run compare，TC 级对比 | ✅ | **Wave 1 修复路由**；demo：pass→fail `newFailures=[TC-001]`，fail→verify `fixed=[TC-001]` |
| 10 | 概览最近 7 次通过率趋势 | ✅ | demo：`GET /stats/trend?days=7` ≥1 数据点；Overview UI 未目视 |

**Phase 2 小结：** Wave 1 demo-phase2.sh 覆盖 8/10 条（#2 ⏭️，#3 降级为 seed）；compare 路由 ✅；fix apply/verify/limit ✅。

### Phase 2 里程碑补充

| 里程碑 | 结果 | 备注 |
|--------|------|------|
| P2-M1 plan 版本 | ✅ | demo v1→v2→diff |
| P2-M2 fix apply | ✅ | seed + apply + autoVerify E2E；Pi analyze 仍 ⏭️ |
| P2-M3 preset / TC 选择 | ✅ | ci/debug + rerunFailedOnly demo |
| P2-M4 compare / trend / History | ✅ | compare 路由已修；trend demo OK；History UI 未目视 |

---

## Phase 3 — [PRD-Phase3.md §8](PRD-Phase3.md)（10 条）

| # | 验收项 | 结果 | 证据 / 备注 |
|---|--------|------|-------------|
| 1 | Web noVNC → stop → recorded.py | ✅ | Wave 2：`demo-recording.sh` curl E2E；VNC 经 server 反向代理 `host.docker.internal:${vncPort}`；RecordPage「Web 录制」Tab + iframe |
| 2 | 3 Worker 并行 3 project | ⏭️ | compose 仅 1 worker |
| 3 | 同 project 两 run 排队 | ⏭️ | 未测；RunService 内存锁，非 BullMQ 完整链路 |
| 4 | Git push 远程可见 tests/ | ✅ | Wave 3：`demo-git-ci.sh` → `e2e/<timestamp>` 分支 SSH push 本库 |
| 5 | GitHub Action 失败 CI 红 | ⏭️ | composite action 已有；未在 GitHub workflow 跑 |
| 6 | viewer 403 / editor 可 run | ✅ | Wave 4：`demo-rbac.sh` viewer run/push 403，editor run 202 |
| 7 | audit_logs 可查 | ✅ | Wave 4：`GET /audit` 含 `run.start`、`member.invite` |
| 8 | API token scoped 仅 run | ✅ | Wave 3：run token → webhook 202；DELETE project → 403 |
| 9 | 录制 30min idle 释放 | ⏭️ | 无 recorder 会话 |
| 10 | upload 录制仍可用 | ✅ | MVP demo 步骤 3 |

**Phase 3 小结：** #1、#4、#6、#7、#8、#10 ✅；#2/#3/#9 ⏭️；#5 Action 可选。

---

## 文档 vs 真值（为何之前「全已完成」）

| 文档声称 | Wave 0 真值 |
|----------|-------------|
| Phase 2 全量已完成 | compare 路由 ❌；fix 链未 E2E；demo 覆盖 ~40% |
| Phase 3 P3-M2 noVNC 已完成 | Wave 2 已 build 镜像 + VNC 代理 + RecordPage Tab ✅；浏览器内手动操作仍建议补测 |
| demo-phase3.sh 绿 | Wave 3 起含 git-ci + recording；RBAC 见独立 `demo-rbac.sh` |
| AGENT「v1.0.0 全量已完成」 | **过度声明**；诚实状态：MVP ✅，Phase2 ⚠️，Phase3 大部分 ⏭️/❌ |

---

## Wave 1 修复结果（2026-09-19）

| # | 项 | 结果 | 证据 |
|---|-----|------|------|
| 1 | `/runs/compare` 路由顺序 | ✅ | `projects.ts`：`createStatsRouter()` 先于 `createRunRouter()` |
| 2 | demo-phase2.sh 扩展 | ✅ | plan v1/v2+diff、CI timing、compare、rerunFailedOnly、trend |
| 3 | fix apply/verify E2E | ✅ | psql seed + `fix/apply` + `autoVerify`，verify 1 passed |
| 4 | FIX_ITERATION_LIMIT | ✅ | insert iterations 2,3 → 4th apply 422 |
| 5 | demo-phase2.sh 执行 | ✅ | **退出码 0**，末次 CI ~91s，总时长 ~6min |

**剩余 / 降级：**

- Phase 2 #2 code/generate from v2：⏭️ 需 Pi
- Phase 2 #3 Pi fix/analyze：⚠️ demo 用 DB seed 替代
- MVP #9 fix/analyze（Pi）：⏭️ demo-saucedemo 全绿仍跳过
- Phase 3 / recorder / RBAC：未在本 Wave 范围

---

## Wave 2 结果（Web 录制 / P3-M2）（2026-09-19）

| # | 项 | 结果 | 证据 |
|---|-----|------|------|
| 1 | recorder 镜像 build | ✅ | `ai-auto-test-playwright-recorder:latest` |
| 2 | VNC 反向代理（HTTP + WS） | ✅ | `server/src/routes/vnc-proxy.ts` → `host.docker.internal:${vncPort}` |
| 3 | docker-compose extra_hosts | ✅ | server `host.docker.internal:host-gateway` |
| 4 | RecordPage Web 录制 Tab | ✅ | iframe + start/stop |
| 5 | demo-recording.sh curl E2E | ✅ | create → init-template → record/start → wait → stop → `tests/recorded/*.py` |

**剩余 / 降级：**

- noVNC iframe 内手动点击操作：⏭️ 需浏览器目视
- 30min idle 释放：⏭️ 未在本 Wave 计时验证
- 全局会话上限 503：⏭️ 未测

---

## Wave 3 结果（Git + CI / P3-M3-M4）（2026-09-20）

| # | 项 | 结果 | 证据 |
|---|-----|------|------|
| 1 | server 镜像 git + openssh | ✅ | `docker/server/Dockerfile`；compose 挂载 `~/.ssh:ro` |
| 2 | git-service SSH URL | ✅ | `git@github.com:paulwong888/ai-auto-test-all.git`，无 HTTPS token |
| 3 | sync clone + scaffold merge | ✅ | clone 本库；缺 tests/ 时 merge scaffold |
| 4 | push e2e/* 分支 | ✅ | 分支 `e2e/1789836846613`，远程 `git ls-remote` 可见 |
| 5 | API token + webhook CI | ✅ | `POST /tokens` → `POST /webhooks/ci/run` → run passed |
| 6 | trigger_source=ci | ✅ | psql 验证 webhook run |
| 7 | run token DELETE → 403 | ✅ | `TOKEN_SCOPE_DENIED` / 403 |
| 8 | demo-git-ci.sh | ✅ | 退出码 0，~122s |

**剩余 / 降级：**

- GitHub Action workflow 在远程仓跑红/绿：⏭️ 可选
- PR 创建（需 HTTPS token）：⏭️ 未测

---

## Wave 4 结果（RBAC + 审计 / P3-M5）（2026-09-20）

| # | 项 | 结果 | 证据 |
|---|-----|------|------|
| 1 | docker-compose.auth.yml | ✅ | `AUTH_DISABLED=false` override |
| 2 | 创建项目 → owner member | ✅ | `POST /projects` + `project_members` |
| 3 | members API | ✅ | `GET/POST/DELETE /members` |
| 4 | RBAC 路由守卫 | ✅ | plan/workflow/fix/record/run/git |
| 5 | audit API + 埋点 | ✅ | `run.start`、`member.invite`；`git.push` 已接线 |
| 6 | demo-rbac.sh | ✅ | 退出码 0，~2s |
| 7 | AuthGuard + MembersPage | ✅ | `/projects/:id/settings/members` |

**剩余 / 降级：**

- org 多租户 / GitHub OAuth：⏭️ 未在本 Wave
- 浏览器内 Members 页目视：⏭️ curl 已验 API

---

## Wave 1 优先修复清单（按影响排序）

1. ✅ **修复 `/runs/compare` 路由顺序** — 已完成
2. ✅ **扩展 demo-phase2.sh** — 已完成
3. ✅ **fix apply/verify E2E** — 已完成（seed patches）
4. 🔧 MVP #9：故意失败 run + fix/analyze（或 mock）— 仍 ⏭️

---

## 复现命令

```bash
cd docker && docker-compose up -d

# MVP
cd .. && MODE=ci SEED_TESTS=always ./scripts/demo-saucedemo.sh
MODE=debug SEED_TESTS=always ./scripts/demo-saucedemo.sh

# Phase 2（Wave 1 全量验收）
./scripts/demo-phase2.sh   # 退出码 0

# Phase 3（Git + CI + recording）
./scripts/demo-git-ci.sh
./scripts/demo-phase3.sh

# Wave 4 RBAC（需 auth override）
cd docker && docker-compose -f docker-compose.yml -f docker-compose.auth.yml up -d server
cd .. && ./scripts/demo-rbac.sh
cd docker && docker-compose up -d server   # 恢复 AUTH off

# compare 路由（Wave 1 已修复）
curl -s "http://localhost:3001/api/projects/<PID>/runs/compare?runA=<R1>&runB=<R2>"

# Wave 2 Web 录制 smoke
./scripts/demo-recording.sh

# 或手动
curl -s -X POST "http://localhost:3001/api/projects/<PID>/record/start" \
  -H 'Content-Type: application/json' \
  -d '{"moduleName":"saucedemo","targetUrl":"https://www.saucedemo.com"}'
```
