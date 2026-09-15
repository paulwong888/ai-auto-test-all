---
name: e2e-test-env
description: AI 自动化测试平台 E2E 环境：共享 Playwright 运行命令、Keycloak storageState 登录、新项目脚手架。在 playwright not found、npm install 失败、SSO 登录、redirect_uri 错误、或编写/执行 Playwright spec 时使用。
---

# E2E 测试环境（auto-test-platform）

本 skill 适用于 **ai-test-platform 容器内** Pi Agent 执行 Playwright E2E 剧本。

## 何时使用

- 执行或编写 `tests/e2e/*.spec.ts` 单剧本测试
- 报错 `playwright: not found`、`sh: playwright: not found`
-  tempted 执行 `npm install @playwright/test` 或 `npx playwright`
- 项目有 Keycloak / SSO，需 `auth.setup.ts` + `storageState`
- `Invalid parameter: redirect_uri` 或 Keycloak 登录失败
- 新项目缺少 `.pi/`、`playwright.config.ts`、`tests/e2e/`

## 铁律

1. **禁止** `npm install`、`npx playwright`、修改业务 repo 的 `package.json`
2. **只能**修改当前任务指定的单个 `tests/e2e/<feature-id>.spec.ts`
3. **禁止**修改 `src/` 等业务代码
4. 有 `auth.setup.ts` 时 **禁止**在 spec 里 mock Keycloak / 写登录流程
5. 使用 `test.step` 组织步骤时 **必须** `await test.step(...)`，否则报 `Test ended`
6. 执行测试 **必须**使用下方共享 Playwright 命令（见 [playwright-command.md](references/playwright-command.md)）

## Playwright 运行命令

容器内固定路径：

- `NODE_PATH=/app/sandbox-repos/demo-app/node_modules`
- CLI=`/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js`

标准命令形态：

```bash
cd '<项目根目录>' && \
{ [ -f .env.e2e ] && set -a && . ./.env.e2e && set +a; true; } && \
NODE_PATH='/app/sandbox-repos/demo-app/node_modules' \
PLAYWRIGHT_BASE_URL='<被测URL>' \
node '/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js' \
  test --config playwright.config.ts tests/e2e/<feature-id>.spec.ts
```

完整模板与示例见 [references/playwright-command.md](references/playwright-command.md)。

## SSO / Keycloak

当项目存在 `tests/e2e/auth.setup.ts` 与 `playwright.config.ts` 中的 `storageState` 时：

1. 登录由 **auth.setup 项目**自动完成（读取 `.env.e2e`）
2. 业务 spec 的 Given「已登入」→ 直接 `page.goto('/')` 或目标路由
3. **不要** `page.route` mock SSO、不要 `loginAs()` 假登录
4. `.env.e2e` 格式（单账号）：
   ```
   PLAYWRIGHT_BASE_URL=http://172.26.9.212:8026
   E2E_USERNAME=...
   E2E_PASSWORD=...
   ```
   多角色 Gherkin（case/corp/无角色）需多账号：
   ```
   E2E_CASE_USERNAME=...    E2E_CASE_PASSWORD=...
   E2E_CORP_USERNAME=...    E2E_CORP_PASSWORD=...
   E2E_UNKNOWN_USERNAME=... E2E_UNKNOWN_PASSWORD=...
   ```
   `auth.setup.ts` 生成 `tests/e2e/.auth/{case,corp,unknown}-user.json`；
   spec 用 `browser.newContext({ storageState: '...' })` 按情境加载，**禁止 mock Keycloak**。
5. `PLAYWRIGHT_BASE_URL` / 项目 `targetUrl` **必须**是 Keycloak 客户端已登记的 **redirect_uri**（不要用未登记的 `host.docker.internal`）

## 新项目脚手架

Dashboard「管理项目 → 建立并初始化模板」会生成：

| 文件 | 说明 |
|------|------|
| `.pi/pi-permissions.jsonc` | 允许共享 Playwright bash 命令 |
| `.pi/AGENTS.md` | Pi 行为准则 |
| `playwright.config.ts` | 无 SSO 或 Keycloak（setup + storageState）版 |
| `tests/e2e/` | 测试目录 |
| `.env.e2e.example` | 账号占位 |
| `.env.e2e` | Keycloak 模式且向导填了账号时创建（勿提交 Git） |
| `tests/e2e/auth.setup.ts` | Keycloak 模式 |
| `.gitignore` | 追加 `.env.e2e`、`tests/e2e/.auth/` |

## 常见错误对照

| 现象 | 处理 |
|------|------|
| `playwright: not found` | 改用共享 CLI + `NODE_PATH`，禁止 npm install |
| `npm install` EISDIR / 超时 | 停止 install，改用共享 CLI |
| `Invalid parameter: redirect_uri` | 将 targetUrl 改为 SSO 白名单地址（如 `http://172.26.9.212:8026`） |
| `Invalid username or password` | 更新项目根目录 `.env.e2e` 后重跑 auth.setup |
| spec mock 登录后卡在 `#state=...` | 删除 mock 登录，改用 storageState |
| `page.goto: Test ended` | 检查是否遗漏 `await test.step(...)` |
| CRM `/SearchPage?caseNo=` 等冷启动空白 | 先 `page.goto('/')` 等 `/home/case` 与权限加载，再带 query 进 SearchPage |
| email 搜案结果断言失败 | email 结果按手机号分组为 `<h3>Mobile No.: 91234567 (1)</h3>`，用 `getByRole('main').getByRole('heading', { level: 3, name: /Mobile No\.:/ })`，勿用 `getByText` 跨节点 regex |
| 多次 `page.route` 互相干扰 | 每个 scenario 前 `await page.unroute(/getCaseHeader/i)` 再注册新拦截 |
| 手动 Search 后 `Cannot find any case`（THREE_CORP） | 手动 Search Case 会按 `CASE_BRAND_TENANT_LIST` 过滤品牌；测企业/贵宾用 `/SearchPage?caseNo=` CRM 入口 |
| 点击企业案例后期望 `/ViewPage` 超时 | `SearchCaseTable` 先 push `/ViewPage`，`ViewCase.js` 再 redirect 到 `/FormPage/corp` 或 `/FormPage/elite`；断言最终 URL |
| 点击行后导航 hang | mock `getCaseSheetConfig`、`getCustomerByAccountId`、count API（含 `closedCaseCount: 0`） |

## 搜案结果点击开检视

- 三电讯（`externalId === ''`）→ `/Form/generalCaseCRM`；需 mock `getCustomerByAccountId`
- 非三电讯 guest → `/Form/generalCaseGuest`
- 企业 `THREE_CORP` → 先 `/ViewPage` 再 redirect `/FormPage/corp`；**手动 Search 无法显示**，用 CRM `?caseNo=`
- mock `brand` 须在 `CASE_BRAND_TENANT_LIST`（如 `THREE_THREE_PREPAID`）才适用于手动 Search Case

## CRM 带参自动搜案（`/SearchPage?caseNo=` 等）

- `SearchPage.js` 读 URL query → Redux `isCRMComing=true` → `SearchGeneralCase` 自动 POST `getCaseHeader`
- 栏位 name：`caseNo` / `mobileNumber` / `accountNumber` / `subscriptionID` / `emailAddress`
- mock API：`page.route(/getCaseHeader/i)` 在 goto 前注册；fulfill 裸数组 `[{ caseNo, brand, caseDetailList: [...] }]`
- email 搜案 UI 不是 Tabulator grid，而是 `SearchByEmailAddress` 按手机号分组的 h3 标题

## CRM SPA 深链与 mock 清单

| 模式 | 要点 |
|------|------|
| 冷启动禁止 | `/NewCreatePage/*`、`/View/*` 等 **禁止** 首屏 `page.goto` 深链 |
| initApp | 先 `goto('/')` → 等 `/home/case` 与 My Overview 就绪 |
| 进深链 | SearchPage Create Case（client push）或 `pushState+popstate`（View/Incident） |
| mock 搜案 | `getCaseHeader` |
| mock 建案 | `getBrandInfoWithToken`、`getCustomerByMobileWithToken`、`getCase*CountBy*` |
| mock 事件 | `getIncidentById` 回傳**事件物件**；`getCaseIncidentSubcaseByIncidentNo` / `getIncidentActivityLogById` 回傳**裸陣列 `[]`**（勿包 `{ code, result }`，否則 Activity `.map` 崩潰） |
| 断言时机 | 等 API/文案/loading 结束，勿 URL 一到就 assert |

深链路由必须先 initApp，详见 [playwright-command.md](references/playwright-command.md)。

## 自愈流程

1. 确认使用 [共享 Playwright 命令](references/playwright-command.md)
2. **执行前** `read` 本 skill 与同目录其它 spec（**只读**，学 initApp / mock / 导航）
3. `read` 当前 spec 与 `feature.sourceFile` 相关组件
4. **已有 spec 时优先小步 edit**，禁止无必要整文件 write 覆盖
5. 仅修改指定 spec 文件
6. 用同一命令重跑，直到 Then 断言通过
7. 仍失败时检查是否误用 mock 登录、冷启动深链或错误 baseURL
