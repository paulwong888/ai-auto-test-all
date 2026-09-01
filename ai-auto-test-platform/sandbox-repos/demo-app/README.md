# Demo App

独立的示例 React 前端，用于手动体验或作为自动化测试的**可选**审计目标。

与 AI 自动化测试平台**无运行时依赖**，可单独部署、单独启停。

## 快速启动

```bash
cd docker
cp .env.example .env   # 首次
./build.sh
./start.sh
```

默认访问：**http://localhost:8037**

| 页面 | 路径 |
|------|------|
| 首页 | `/` |
| 登录 | `/login` |
| 控制台 | `/dashboard` |

测试账号：`admin` / `123456`

## 与测试平台的关系

- 本仓库位于 `sandbox-repos/demo-app`，测试平台可通过挂载目录对其做**源码审计**（生成 Gherkin）
- 测试平台**不会**自动启动本应用；Playwright 执行时需自行指定被测 URL（如 `http://localhost:8037`）
- 二者使用各自的 `docker/` 与 `.env`，互不影响
