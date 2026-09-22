const PASSED_RE = /(\d+)\s+passed/i;
const FAILED_RE = /(\d+)\s+failed/i;
const ERROR_RE = /(\d+)\s+errors?/i;
const SKIPPED_RE = /(\d+)\s+skipped/i;
const DURATION_RE = /in\s+([\d.]+)s/i;

export function parsePytestSummaryFromLogs(logLines: string[]): {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
} {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs = 0;

  for (let i = logLines.length - 1; i >= 0; i -= 1) {
    const line = logLines[i] ?? "";
    if (!/passed|failed|error|skipped/i.test(line)) continue;

    if (passed === 0) {
      const m = PASSED_RE.exec(line);
      if (m) passed = Number(m[1]);
    }
    if (failed === 0) {
      const failedMatch = FAILED_RE.exec(line);
      const errorMatch = ERROR_RE.exec(line);
      failed =
        (failedMatch ? Number(failedMatch[1]) : 0) + (errorMatch ? Number(errorMatch[1]) : 0);
    }
    if (skipped === 0) {
      const m = SKIPPED_RE.exec(line);
      if (m) skipped = Number(m[1]);
    }
    if (durationMs === 0) {
      const m = DURATION_RE.exec(line);
      if (m) durationMs = Math.round(Number(m[1]) * 1000);
    }
    if (passed || failed || skipped) break;
  }

  return { passed, failed, skipped, durationMs };
}
