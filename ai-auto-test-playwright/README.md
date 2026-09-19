# ai-auto-test-playwright

Web 化 Playwright pytest E2E 自动化平台（MVP v0.1.0）。

## 文档索引

| 文档 | 说明 |
|------|------|
| [PRD.md](./PRD.md) | 产品需求、API、MVP 验收标准 |
| [AGENT.md](./AGENT.md) | Agent/开发施工指南（**开发必读**） |
| [PRD-MVP-Implementation.md](./PRD-MVP-Implementation.md) | M1–M4 里程碑、完成状态、实现差异 |

## 快速启动（Docker，四服务）

```bash
cd docker
cp .env.example .env
cp .env.local.example .env.local   # 填入 DASHSCOPE_API_KEY
docker-compose up --build -d
# 若无 docker compose 插件，用 docker-compose；若有则用 docker compose up --build -d
```

Pi / 阿里云百炼：编辑 `docker/.env.local`，填入 `DASHSCOPE_API_KEY`（[百炼控制台](https://bailian.console.aliyun.com/)）。验证：

```bash
docker exec ai-auto-test-playwright-server pi --version
```

### 服务地址

| 服务 | 地址 |
|------|------|
| **Web Dashboard** | http://localhost:8040 |
| API（直连） | http://localhost:3001 |
| Health（经 Dashboard 反代） | http://localhost:8040/health |
| PostgreSQL | localhost:5434 |

打开 Dashboard：http://localhost:8040/projects

## Demo 脚本（MVP 验收）

```bash
# 默认 debug 模式（headed + slowmo 600）
./scripts/demo-saucedemo.sh

# CI 快速回归（headless）
MODE=ci ./scripts/demo-saucedemo.sh

# 无 LLM 时自动预置参考 tests/ 跳过 Pi
SEED_TESTS=always ./scripts/demo-saucedemo.sh
```

脚本走通：创建项目 → init → upload →（可选 Pi plan/code 或 seed tests）→ run → report → fix/analyze（失败时）。

完整验收对照 [PRD.md 第 9 章](./PRD.md#9-mvp-验收标准)。

## MVP 验收

```bash
cd docker && docker-compose up --build -d
curl http://localhost:8040/health
curl http://localhost:8040/projects   # 浏览器打开

SEED_TESTS=always MODE=ci ../scripts/demo-saucedemo.sh
```

## 本地开发（不用 Docker）

```bash
npm install
npm run dev -w server          # API :3001
npm run dev:dashboard          # UI :8040（代理 /api /ws → 3001）
```

Server 环境：`cd server && cp ../docker/.env.example .env`，设置 `POSTGRES_HOST=localhost`、`POSTGRES_PORT=5434`。
