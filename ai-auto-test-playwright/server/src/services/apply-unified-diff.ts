import { applyPatch } from "diff";
import { normalizeUnifiedDiff } from "./normalize-unified-diff.js";

function extractFileHeaders(diff: string): string | null {
  const match = diff.match(/^--- .+\n\+\+\+ .+\n/m);
  return match ? match[0] : null;
}

function splitHunks(diff: string): string[] {
  const body = diff.replace(/^--- .+\n\+\+\+ .+\n/m, "");
  return body
    .split(/\n(?=@@ )/)
    .map((part) => part.trimEnd())
    .filter((part) => part.startsWith("@@"));
}

function sanitizeHunkBodyLine(line: string): string {
  if (!line) return line;
  const marker = line[0];
  if (marker === " " || marker === "+" || marker === "-" || marker === "@") {
    return line;
  }
  // Pi 常漏写 + 前缀
  return `+${line}`;
}

function rebuildHunkHeader(hunk: string): string {
  const lines = hunk.split("\n");
  const headerLine = lines[0] ?? "@@";
  const bodyLines = lines
    .slice(1)
    .filter((line) => line.length > 0 && !line.startsWith("@@"))
    .map(sanitizeHunkBodyLine);

  let oldLines = 0;
  let newLines = 0;
  for (const line of bodyLines) {
    const marker = line[0];
    if (marker === " " || marker === "-") oldLines += 1;
    if (marker === " " || marker === "+") newLines += 1;
  }

  const oldStartMatch = headerLine.match(/-(\d+)(?:,(\d+))?/);
  const newStartMatch = headerLine.match(/\+(\d+)(?:,(\d+))?/);
  const oldStart = oldStartMatch ? Number(oldStartMatch[1]) : 1;
  const newStart = newStartMatch ? Number(newStartMatch[1]) : 1;

  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@\n${bodyLines.join("\n")}`;
}

function tryApplyPatch(original: string, diff: string): string | false {
  try {
    return applyPatch(original, diff, { fuzzFactor: 3 });
  } catch {
    return false;
  }
}

/** 尝试应用 unified diff；Pi 生成的多 hunk patch 行数常不准，会分 hunk 重算后再应用。 */
export function applyUnifiedDiff(original: string, raw: string): string | false {
  const diff = normalizeUnifiedDiff(raw);

  const whole = tryApplyPatch(original, diff);
  if (whole !== false) {
    return whole;
  }

  const fileHeaders = extractFileHeaders(diff);
  if (!fileHeaders) {
    return false;
  }

  const hunks = splitHunks(diff);
  if (hunks.length <= 1) {
    return false;
  }

  let content = original;
  for (const hunk of hunks) {
    const rebuilt = rebuildHunkHeader(hunk);
    const piece = `${fileHeaders}${rebuilt}\n`;
    const next = tryApplyPatch(content, piece);
    if (next === false) {
      return false;
    }
    content = next;
  }
  return content;
}
