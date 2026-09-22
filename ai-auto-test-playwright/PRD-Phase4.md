# ai-auto-test-playwright Phase 4 产品需求文档（Run 期 noVNC）

| 项 | 内容 |
|---|---|
| 版本 | v0.1 |
| 日期 | 2026-09-22 |
| 状态 | Implemented（Phase 4.0） |
| 前置文档 | [PRD.md](./PRD.md)、[PRD-Phase3.md](./PRD-Phase3.md) |
| 前置条件 | Phase 3 验收通过（含 Web 录制 noVNC） |
| 实施拆解 | [PRD-Phase4-Implementation.md](./PRD-Phase4-Implementation.md) |
| 速查 | [docs/RUN-VNC.md](./docs/RUN-VNC.md) |

---

## 1. 背景与目标

### 1.1 Phase 3 后的遗留痛点

Phase 3 已在 **录制** 场景提供 noVNC（[`RecordPage`](dashboard/src/pages/RecordPage.tsx) iframe + [`vnc-proxy`](server/src/routes/vnc-proxy.ts)）。**执行（Run）** 场景仍无法满足「观察浏览器」：

| 痛点 | 当前实现 | Phase 4 目标 |
|------|----------|--------------|
| Debug 勾选 Headed 无画面 | Worker 内 [`xvfb-run`](worker/server.py) + `--headed`，虚拟屏不可见 | Dashboard Run 页嵌入 noVNC，**实时观看**自动化 |
| ADR-004 与体验脱节 | PRD 默认 headed + slowmo 便于观察，实际仅终端日志 | 与 ADR-004 对齐：Web 内可观察执行过程 |
| 与录制 VNC 混淆 | 用户以为 Run Headed 也会弹窗或共用录制 Tab | 文档与 UI 明确 **Record VNC ≠ Run VNC** |

### 1.2 用户故事

作为测试工程师，我在 Dashboard 选择 **debug**（或 custom + headed）启动 pytest 后，希望在 **同一 Run 页** 通过 noVNC 看到 Playwright 浏览器逐步操作，而无需在本机安装浏览器或 SSH 进容器。

### 1.3 文档关系

```
PRD.md
PRD-Phase3.md                    ← Record noVNC（已交付）
PRD-Phase4.md                    ← Run 期 VNC（本文档，产品）
PRD-Phase4-Implementation.md     ← 里程碑与工程方案
docs/RUN-VNC.md                  ← 用户/运维速查
AGENT.md                         ← Agent 限制与链接
```

### 1.4 成功指标

| 指标 | 目标 |
|------|------|
| debug run 预览可用率 | >= 95%（Worker healthy、headed 路径） |
| 预览首帧可交互时间 | run 开始后 < 15s（含 Xvfb/VNC 就绪） |
| 用户误解率（Run Headed = 本地弹窗） | 通过 Run 页说明 + RUN-VNC 文档显著下降 |

---

## 2. 范围

### 2.1 包含

| 项 | 说明 |
|----|------|
| Run 页 noVNC iframe | 运行中展示；支持缩放/全屏（复用 Record 的 embed 参数与 UX 模式） |
| `vncPreview` 开关 | `preset=debug` 默认 **true**；`preset=ci` 默认 **false**；`custom` 由 body 指定，且需 `headed=true` 才生效 |
| Server 反向代理 | 路径与 Record 平行：`/api/projects/:id/runs/:runId/vnc/...` |
| 鉴权 | RBAC 与 `POST run` 一致（owner / editor / ci_bot）；`AUTH_DISABLED=false` 时使用短期 VNC JWT（对称 [`record-live.ts`](server/src/routes/record-live.ts)） |
| 生命周期 | run `status=running` 且 preview 启用时返回 `vncUrl`；run 结束代理返回 404/410，UI 收起 iframe |

### 2.2 不包含（Out of Scope）

| 项 | 说明 |
|----|------|
| macOS / Windows **本地弹窗** | 仍不在宿主机打开 Chromium |
| headless / ci 预览 | 无浏览器 UI，不提供 VNC |
| 多路并行 VNC（多 Worker 各一路） | Phase 4.0 仅 **单 Worker 单预览**；多 Worker 动态端口见实施 PRD 备选 |
| VNC 内反向操控 pytest | 默认 **只读观看**；键盘鼠标不注入自动化（避免与 Playwright 冲突） |
| 替代 HTML 报告 / trace | 报告与 trace 仍为事后分析主路径 |

---

## 3. 与现有能力关系

### 3.1 Record VNC vs Run VNC

| 维度 | Record（Phase 3） | Run（Phase 4） |
|------|-------------------|----------------|
| 目的 | 人工操作浏览器，产出 `recorded/*.py` | 观看 **pytest 自动化** 执行 |
| 容器/进程 |  ephemeral **recorder** 容器 | **worker** 内长生命周期虚拟桌面 |
| 触发 | `POST record/start` | `POST run` + `vncPreview` |
| 代理路径 | `/record/:sessionId/vnc` | `/runs/:runId/vnc` |
| UI | Record → Web 录制 Tab | Run → 执行页预览区 |

### 3.2 Headed 与 VNC

- **`headed`**：Playwright 启动有头 Chromium（语义不变）。
- **`vncPreview`**：是否向 Dashboard 暴露 noVNC URL；仅当 headed 执行时有意义。
- headless 时忽略 `vncPreview: true`（API 可接受但不生效，响应无 `vncUrl`）。

---

## 4. 功能需求

| ID | 功能 | 说明 |
|----|------|------|
| P4-RUN-VNC-01 | 运行中预览 | Run 页在 `running && vncUrl` 时展示 iframe |
| P4-RUN-VNC-02 | 结束收起 | run completed/failed/cancelled 后隐藏预览并提示「执行已结束」 |
| P4-RUN-VNC-03 | 缩放与全屏 | 与 Record 一致：`resize=scale`、`autoconnect`；可选全屏 + Esc |
| P4-RUN-VNC-04 | 降级提示 | Worker 无 VNC 或 preview 不可用时，仅展示终端，不报错阻塞 run |
| P4-RUN-VNC-05 | preset 默认 | debug → preview on；ci → off |
| P4-RUN-VNC-06 | 说明文案 | 明确「浏览器在 Worker 虚拟桌面运行，非本机窗口」 |

---

## 5. API 草案

### 5.1 启动执行（扩展）

**`POST /api/projects/:id/run`**

在现有 body（`preset`、`headed`、`slowmo`、`specFilter`、`rerunFailedOnly` 等）上增加：

```json
{
  "preset": "debug",
  "vncPreview": true
}
```

| 字段 | 类型 | 默认 | 规则 |
|------|------|------|------|
| `vncPreview` | boolean \| null | 见 preset | `debug` → true；`ci` → false；`custom` → body 值，默认 false；仅 `headed` 最终为 true 时生效 |

**响应（扩展）** — 与现有 run 记录一并返回，或在 `GET runs/:runId` 中提供：

```json
{
  "id": "run-uuid",
  "status": "running",
  "vncUrl": "/api/projects/:projectId/runs/:runId/vnc",
  "vncToken": "optional-jwt-when-auth-enabled"
}
```

### 5.2 VNC 入口

| 方法 | 路径 | 行为 |
|------|------|------|
| GET | `/api/projects/:id/runs/:runId/vnc` | 302 → `.../vnc/vnc.html?token=...&resize=scale&autoconnect=true` |
| GET/WS | `/api/projects/:id/runs/:runId/vnc/*` | Server 反向代理至 Worker websockify（内网 `worker:6080` 或配置项） |

### 5.3 查询 run

**`GET /api/projects/:id/runs/:runId`**

- `status !== "running"` → `vncUrl: null`
- 未启用 preview 或 headless → `vncUrl: null`

### 5.4 WebSocket

- 沿用现有 `run_started` / 终端 NDJSON；可选扩展 `run_started` payload 含 `vncUrl`、`vncToken`（与 Record 对齐，减少轮询）。

---

## 6. UI 需求

**页面：** [`/projects/:id/run`](dashboard/src/pages/RunPage.tsx)

| 元素 | 行为 |
|------|------|
| 预览区 | `running && vncUrl` 时显示 iframe（`buildVncEmbedUrl` 与 Record 共用逻辑，可抽 util） |
| 说明 | Headed 在 Worker 虚拟桌面；此处为 noVNC 预览 |
| debug preset | 无需额外勾选即可出现预览（实现后） |
| custom | headed 勾选 + 可选「浏览器预览」checkbox（映射 `vncPreview`） |
| ci | 不展示预览控件 |

---

## 7. 非功能需求

| 类别 | 要求 |
|------|------|
| 并发 | 与 [ADR-P3-003](./PRD-Phase3.md) 一致：同 project run 串行；全局 Phase 4.0 假定 **单 Worker 单 VNC 会话** |
| 安全 | VNC token 绑定 `runId` + `projectId` + 过期时间；禁止跨 project 访问 |
| 性能 | 预览延迟可接受 1–3s；不显著拉长 pytest 启动 |
| 运维 | `WORKER_VNC_HOST` / `WORKER_VNC_PORT` 可配置（见实施 PRD） |

---

## 8. 验收标准

1. **debug run + 预览**：SauceDemo 项目 debug 启动后，Run 页 iframe 可见浏览器访问被测站并逐步执行（headed + slowmo）。
2. **run 结束**：完成后 iframe 关闭或置灰，`GET run` 无 `vncUrl`。
3. **ci run**：`preset=ci` 响应无 `vncUrl`，Run 页无预览区。
4. **鉴权**：`AUTH_DISABLED=false` 时无 token 访问 vnc 返回 401；有权限用户可打开。
5. **headless 忽略**：`preset=ci` + `vncPreview: true` 仍不暴露 VNC。
6. **文档**：README / RUN-VNC 可解释 Record vs Run VNC；MVP 实现差异表不再写「Phase 3 noVNC 解决 Run headed」。

---

## 9. 架构决策

### ADR-P4-001：Run VNC 复用 noVNC + Server 代理

**决策：** Run 期预览采用与 Record 相同的 **noVNC + websockify + server 反向代理** 模式，浏览器在 Worker 虚拟显示器上运行，**不要求**用户本机 `DISPLAY`。

**理由：** 与 Phase 3 运维经验一致；Dashboard 仅 iframe，无需新客户端。

**后果：** Worker 镜像增大；需管理 Xvfb/x11vnc 生命周期；与 ADR-004（headed + slowmo 观察）产品意图一致。

### ADR-P4-002：Phase 4.0 单 Worker 固定 VNC 端口

**决策：** 优先内网 `worker:6080`，不依赖 `host.docker.internal` 动态映射。

**理由：** 与当前 compose 单 Worker、project 级 run 锁匹配。

**备选（Phase 4.1）：** 按 run 起 ephemeral 容器 + 动态端口（复刻 recorder）以支持多 Worker 并行预览。

---

## 附录 A：现状变通（Phase 4 交付前）

| 需求 | 做法 |
|------|------|
| 看实时浏览器 | 本机进入 project workspace：`cd tests && pytest specs/ --headed --slowmo 600 -v` |
| 看执行结果 | Run 页 LiveTerminal + 运行历史 → HTML 报告 |
| 看失败步骤 | 报告内 trace / `playwright show-trace` |
| 人工录操作 | Record → **Web 录制** Tab（Phase 3 noVNC） |

---

## 附录 B：能力矩阵（Phase 3 → Phase 4）

| 能力 | Phase 3 | Phase 4 |
|------|---------|---------|
| Web 录制 noVNC | ✓ | ✓ |
| Run headed（Worker Xvfb） | ✓ | ✓ |
| Run 期 noVNC 预览 | — | ✓（计划） |
| run preset debug/ci | ✓ | ✓ + preview 默认 |
