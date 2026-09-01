# AI 自动化测试平台

基于 **Pi Agent + Gherkin + Playwright** 的 Web 自动化探索性测试系统。

## 目录结构

```
ai-test-platform/
├── docker/               # Docker Compose + 运维脚本 + .env
├── test-server/          # Node.js 后端（Pi RPC 客户端 + 审计 API）
├── test-dashboard/       # Vite + React + Tailwind 控制台（指令三完善）
├── sandbox-repos/        # 可选的待测前端源码（与平台独立部署）
│   └── demo-app/         # 示例 React 应用（自有 docker/，可单独运行）
└── REQUIREMENT.md        # 完整架构与实施指令
```

## Docker 部署（推荐）

```bash
cd docker

# 1. 复制并编辑环境变量（填入 LLM API Key）
cp .env.example .env

# 2. 构建镜像
./build.sh

# 3. 启动
./start.sh

# 3. 访问
# Dashboard : http://localhost:8036
# Backend   : http://localhost:3001
```

运维脚本：

| 脚本 | 说明 |
|------|------|
| `./build.sh` | 构建 Docker 镜像 |
| `./start.sh` | 启动所有服务 |
| `./restart.sh` | 重启服务（不重新构建） |
| `./shutdown.sh` | 停止并移除容器 |
| `./logs.sh` | 查看全部日志 |
| `./logs.sh server` | 仅查看后端日志 |

所有环境变量均在 `docker/.env` 中配置，参见 `docker/.env.example`。

**Higress LLM**：默认对接宿主机 Higress 网关（`HIGRESS_BASE_URL=http://host.docker.internal:8004/v1`）。请确保 Higress 已在宿主机运行（见 `ai-middleware/higress/QUICKSTART.md`），并在 `docker/.env` 中设置 `PI_MODEL`（如 `qwen-32b`）。

**监听地址**：后端与 Dashboard 均绑定 `0.0.0.0`，局域网可通过 `http://<宿主机IP>:8036` 访问。

## 多项目管理

控制台支持在 UI 中增删改测试项目，每个项目包含 **名称、源码路径、被测 URL**。项目数据持久化在 `docker/data/projects.json`（通过 Docker volume 挂载）。

### 路径规则

`repoPath` 必须是容器内绝对路径，且落在以下前缀之一：

| 前缀 | 用途 |
|------|------|
| `/app/sandbox-repos/` | 平台内置 `sandbox-repos/` 下的项目 |
| `/data/repos/` | 宿主机外部项目（通过 `EXTERNAL_REPOS_HOST_PATH` 挂载） |

首次启动会自动 seed 一个 `demo-app` 项目（对应当前 demo-app + 8037）。

### 外部项目接入

1. 在 `docker/.env` 中设置 `EXTERNAL_REPOS_HOST_PATH` 指向宿主机项目根目录
2. 将被测前端放在该目录下（或软链进去）
3. 控制台「管理项目」→ 新增，`repoPath` 填 `/data/repos/<项目名>`
4. 项目根目录需包含 `.pi/`、`tests/e2e/`、`playwright.config.ts`（可从 demo-app 复制模板）

`SANDBOX_REPO` / `TARGET_APP_URL` 仍可用于 seed 默认项目，新流程请优先在控制台管理项目。

## 示例前端（独立部署）

`demo-app` 与测试平台**分开运维**，仅在被审计时作为源码目录挂载：

```bash
cd sandbox-repos/demo-app/docker
./build.sh && ./start.sh
# → http://localhost:8037  （admin / 123456）
```

详见 [sandbox-repos/demo-app/README.md](sandbox-repos/demo-app/README.md)。

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 安装 Pi Agent CLI

```bash
npm install -g @earendil-works/pi-coding-agent
# 或设置环境变量 PI_CLI_PATH 指向 pi 可执行文件
```

### 3. 启动后端

```bash
npm run dev:server
```

### 4. 触发全盲审计（生成 FEATURES.json）

```bash
# HTTP API（需指定 projectId）
curl -X POST http://localhost:3001/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"demo-app"}'

# 或 CLI
npm run audit -w test-server
```

### 5. 读取已生成的剧本

```bash
curl 'http://localhost:3001/api/audit/features?projectId=demo-app'
```

### 6. 项目管理 API

```bash
curl http://localhost:3001/api/projects
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 后端端口 |
| `PI_CLI_PATH` | `pi` | Pi Agent 可执行文件 |
| `SANDBOX_REPO` | `sandbox-repos/demo-app` | 默认 seed 项目源码路径 |
| `TARGET_APP_URL` | `http://host.docker.internal:8037` | 默认 seed 项目被测 URL |
| `PROJECTS_FILE` | `docker/data/projects.json` | 项目注册表（本地开发） |
| `EXTERNAL_REPOS_CONTAINER_PATH` | `/data/repos` | 外部项目容器内挂载点 |
| `AUDIT_TIMEOUT_MS` | `600000` | 审计超时（10 分钟） |

## 指令进度

- [x] **指令一**：项目脚手架 + Pi RPC JSONL 解析 + 审计生成 FEATURES.json
- [x] **指令二**：Gherkin 驱动执行 + WebSocket 流式传输
- [x] **指令三**：前端 BDD 控制台（剧本卡片 + 测试直播间）
