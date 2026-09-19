export function buildPlanPrompt(moduleName: string, baseUrl: string): string {
  return `/skill:playwright-codegen

你是 Playwright pytest E2E 测试专家。请阅读 tests/recorded/${moduleName}.py，生成用例计划并写入 tests/plans/${moduleName}-test-plan.md。

被测系统 base URL: ${baseUrl}

计划必须包含：
1. 流程梳理
2. POM 规划（pages/ 文件清单）
3. 数据规划（data/ factory 清单）
4. TC 清单（方法名 test_tcNNN_<name>）
5. 待确认项

只写入计划 markdown 文件，不要生成 specs/pages/data 代码，不要修改 tests/recorded/${moduleName}.py。`;
}
