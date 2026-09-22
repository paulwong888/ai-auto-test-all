export function buildCodePrompt(moduleName: string, baseUrl: string): string {
  return `/skill:playwright-codegen

请阅读已确认的 tests/plans/${moduleName}-test-plan.md，生成完整 pytest POM 工程：
- tests/specs/、tests/pages/、tests/data/
- 遵循 tests/.pi/AGENTS.md 与项目铁律（get_by_role 优先、禁止 time.sleep、禁止改 recorded/）
- 如计划需要登录，更新 tests/conftest.py 添加 ensure_auth_file 与 logged_in_page
- ensure_auth_file 必须使用 BASE_URL 常量（browser.new_context(base_url=BASE_URL)、page.goto(BASE_URL + "/")），勿依赖 pytest-playwright 的 base_url fixture
- logged_in_page 在 new_page() 后须 goto 登录后的落地页（如 inventory.html），storage state 不会自动导航
- 不要修改 tests/recorded/${moduleName}.py

被测系统 base URL: ${baseUrl}`;
}
