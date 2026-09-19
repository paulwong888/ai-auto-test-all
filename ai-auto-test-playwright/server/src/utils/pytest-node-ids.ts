const FAILED_RE = /FAILED\s+(specs\/[^\s]+::[^\s]+)/g;

export function parseFailedNodeIdsFromLogs(logLines: string[]): string[] {
  const text = logLines.join("\n");
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = FAILED_RE.exec(text)) !== null) {
    ids.add(match[1]!);
  }
  return [...ids];
}

export function extractTcNumber(nodeId: string): string | null {
  const m = nodeId.match(/test_tc(\d+)/i) ?? nodeId.match(/TC-(\d+)/i);
  if (!m) return null;
  return `TC-${m[1]!.padStart(3, "0")}`;
}

export function parseTcListFromPlan(content: string): string[] {
  const ids = new Set<string>();
  const re = /TC-(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    ids.add(`TC-${match[1]!.padStart(3, "0")}`);
  }
  return [...ids].sort();
}
