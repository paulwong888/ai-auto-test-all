export function buildFixPrompt(runId: string): string {
  return `/skill:playwright-fix

分析 Playwright pytest 运行失败（runId: ${runId}）。

请按以下步骤操作：
1. 阅读 tests/.runs/${runId}/run.log 中的失败信息
2. 扫描 tests/test-results/**/trace.zip 路径
3. 结合 playwright-fix skill 分析根因并生成修复 patch

必须将结果写入 tests/.runs/${runId}/fix-analysis.json，JSON 格式：
{
  "failingTests": [
    { "tc": "TC-001", "nodeId": "specs/test_x.py::TestX::test_tc001_name", "error": "错误摘要" }
  ],
  "analysis": "## 根因判断\\n\\n...\\n\\n## 修复建议\\n\\n...",
  "patches": [
    {
      "file": "tests/pages/example_page.py",
      "description": "修复定位器",
      "unifiedDiff": "--- a/tests/pages/example_page.py\\n+++ b/tests/pages/example_page.py\\n@@ -1,3 +1,3 @@\\n-old\\n+new\\n"
    }
  ]
}

要求：
- failingTests 从 run.log 提取
- patches 使用 unified diff 格式，file 必须在 tests/ 目录下
- 可直接修改 tests/ 下的 page 或 spec 文件以修复失败用例`;
}
