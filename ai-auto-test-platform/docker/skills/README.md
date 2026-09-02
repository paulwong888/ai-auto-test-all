# Pi Agent Skills（auto-test-platform）

本目录下的 skill 在 **server 镜像构建** 时复制到 `/etc/pi-agent/skills/`，容器启动时同步到 `~/.pi/agent/skills/`。

## 当前 Skills

| 目录 | 名称 | 用途 |
|------|------|------|
| `e2e-test-env/` | e2e-test-env | Playwright 共享运行时、Keycloak SSO、新项目脚手架、环境排错 |

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
   docker exec ai-test-platform-server ls /root/.pi/agent/skills/e2e-test-env/
   docker exec ai-test-platform-server cat /root/.pi/agent/settings.json
   ```

## Pi 加载方式

- 全局：`~/.pi/agent/skills/`（entrypoint 自动安装）
- settings：`/etc/pi-agent/skills` 注册于 `settings.json`
- 交互：`/skill:e2e-test-env`
- RPC 剧本：`run-service` 启动 Pi 时追加 `--skill /etc/pi-agent/skills/e2e-test-env`，首条 prompt 以 `/skill:e2e-test-env` 强制展开 skill 全文（不依赖 agent 自行 read）
