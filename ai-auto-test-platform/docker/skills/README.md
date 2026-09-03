# Pi Agent Skills（auto-test-platform）

本目录下的 skill 在 **server 镜像构建** 时复制到 `/etc/pi-agent/skills/`，容器启动时同步到 `~/.pi/agent/skills/`。

## 当前 Skills

| 目录 | 名称 | 用途 |
|------|------|------|
| `e2e-test-env/` | e2e-test-env | Playwright 共享运行时、Keycloak SSO、新项目脚手架、环境排错（**剧本执行默认加载**） |
| `component-aware-web-automation/` | component-aware-web-automation | 组件感知 E2E：7 Agent 流水线（静态分析 → testid → POM → Playwright），见 [monday Director 架构](https://engineering.monday.com/every-playwright-needs-a-director-how-ai-agents-replace-dom-scraping-with-component-aware-static-analysis/) |

## 维护

1. 编辑 `e2e-test-env/SKILL.md` 或 `references/`
2. 若变更与代码逻辑相关，同步更新：
   - `test-server/src/services/playwright-runner.ts`
   - `test-server/templates/project-scaffold/AGENTS.md`
   - `test-server/src/services/run-prompt.ts`
3. 重建 server 镜像：
   ```bash
   cd docker && docker compose build server && docker compose up -d
   ```
4. 验证：
   ```bash
   docker exec ai-test-platform-server ls /root/.pi/agent/skills/
   docker exec ai-test-platform-server ls /root/.pi/agent/skills/component-aware-web-automation/
   docker exec ai-test-platform-server cat /root/.pi/agent/settings.json
   ```

## Pi 加载方式

- 全局：`~/.pi/agent/skills/`（entrypoint 自动安装）
- settings：`/etc/pi-agent/skills` 注册于 `settings.json`（`enableSkillCommands: true`）
- 交互手动加载：
  - `/skill:e2e-test-env` — 执行 Playwright 剧本
  - `/skill:component-aware-web-automation` — 组件感知测试生成（7 Agent 方法论）
- RPC 剧本执行：`run-service` 启动 Pi 时追加 `--skill /etc/pi-agent/skills/e2e-test-env`，首条 prompt 以 `/skill:e2e-test-env` 强制展开 skill 全文（不依赖 agent 自行 read）

> **说明**：`component-aware-web-automation` 当前为 **文档型 skill**（`SKILL.md` + `references/`），不含 `scripts/*.sh`。安装后由 Agent 按文档分步执行；与 `e2e-test-env` 互补，不替代默认执行 skill。
