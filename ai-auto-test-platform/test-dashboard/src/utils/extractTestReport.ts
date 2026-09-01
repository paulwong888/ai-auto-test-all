/** 從 AI 輸出中提取可渲染的測試報告 Markdown */
export function extractTestReport(aiText: string): string | null {
  const trimmed = aiText.trim();
  if (!trimmed) return null;

  const markers = ["## 測試結果", "## 测试结果", "## 測試", "# 測試結果"];
  for (const marker of markers) {
    const idx = trimmed.indexOf(marker);
    if (idx !== -1) {
      return trimmed.slice(idx).trim();
    }
  }

  const hasMarkdown =
    /^#{1,3}\s/m.test(trimmed) ||
    /\|.+\|/.test(trimmed) ||
    /```/.test(trimmed) ||
    /`[^`]+`/.test(trimmed);

  return hasMarkdown ? trimmed : null;
}
