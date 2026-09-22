/**
 * Pi 生成的 unified diff 常把后续 hunk 头误写成 "+@@ ..." 行，导致 applyPatch 解析失败。
 */
export function normalizeUnifiedDiff(raw: string): string {
  let diff = raw.replace(/\r\n/g, "\n").trim();
  if (!diff) return diff;

  // 修复 "+@@ -29,14 +40,12 @@" 这类错误：hunk 头不应带 +/- 前缀
  diff = diff.replace(/\n\+(@@ [^\n]+ @@)/g, "\n$1");
  diff = diff.replace(/\n-(@@ [^\n]+ @@)/g, "\n$1");

  if (!diff.endsWith("\n")) {
    diff += "\n";
  }
  return diff;
}
