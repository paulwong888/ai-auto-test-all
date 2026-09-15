# Playwright 共享运行命令（容器内）

业务 repo **不需要** 安装 `@playwright/test`。使用平台共享运行时：

| 变量 | 容器内路径 |
|------|------------|
| `NODE_PATH` | `/app/sandbox-repos/demo-app/node_modules` |
| CLI | `/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js` |

## 单 spec 执行模板

将 `<REPO>`、`<TARGET_URL>`、`<SPEC>` 替换为实际值：

```bash
cd '<REPO>' && \
{ [ -f .env.e2e ] && set -a && . ./.env.e2e && set +a; true; } && \
NODE_PATH='/app/sandbox-repos/demo-app/node_modules' \
PLAYWRIGHT_BASE_URL='<TARGET_URL>' \
node '/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js' \
  test --config playwright.config.ts <SPEC>
```

示例：

```bash
cd '/data/repos/casemanagement-reduxfrontend' && \
{ [ -f .env.e2e ] && set -a && . ./.env.e2e && set +a; true; } && \
NODE_PATH='/app/sandbox-repos/demo-app/node_modules' \
PLAYWRIGHT_BASE_URL='http://172.26.9.212:8026' \
node '/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js' \
  test --config playwright.config.ts tests/e2e/my-feature.spec.ts
```

## 仅跑 auth setup

```bash
cd '<REPO>' && \
{ [ -f .env.e2e ] && set -a && . ./.env.e2e && set +a; true; } && \
NODE_PATH='/app/sandbox-repos/demo-app/node_modules' \
PLAYWRIGHT_BASE_URL='<TARGET_URL>' \
node '/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js' \
  test --config playwright.config.ts tests/e2e/auth.setup.ts --project=setup
```

## 环境探测（list）

```bash
cd '<REPO>' && \
NODE_PATH='/app/sandbox-repos/demo-app/node_modules' \
PLAYWRIGHT_BASE_URL='<TARGET_URL>' \
node '/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js' \
  test --config playwright.config.ts --list
```

## 深链必须先 initApp

CRM SPA 等应用：**禁止**冷启动 `page.goto('/NewCreatePage/...')` 或 `/View/...`；须先 `goto('/')` 完成 initApp，再通过业务入口或 `pushState+popstate` 进入深链。详见 SKILL.md「CRM SPA 深链与 mock 清单」。

## 禁止使用的命令

- `npx playwright test ...`
- `npm install @playwright/test`
- `npm install --save-dev playwright`
- 不带 `NODE_PATH` 的 `playwright test`
