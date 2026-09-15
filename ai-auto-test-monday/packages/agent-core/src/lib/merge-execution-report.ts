import type { ExecutionReport, ExecutionResult } from "../artifacts/types.js";

function summarizeResults(results: ExecutionResult[]): ExecutionReport["summary"] {
  return {
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    flaky: results.filter((r) => r.status === "flaky").length,
  };
}

export function buildExecutionReport(
  results: ExecutionResult[],
  executionMode: ExecutionReport["executionMode"],
): ExecutionReport {
  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    executionMode,
    summary: summarizeResults(results),
    results,
  };
}

/** Merge partial re-run results into a previous report (by journeyId). */
export function mergeExecutionReport(
  previous: ExecutionReport | null,
  newResults: ExecutionResult[],
  journeyIds: string[],
  executionMode: ExecutionReport["executionMode"],
): ExecutionReport {
  if (!previous || journeyIds.length === 0) {
    return buildExecutionReport(newResults, executionMode);
  }

  const updatedIds = new Set(journeyIds);
  const replaced = new Map(newResults.map((r) => [r.journeyId, r]));

  const merged: ExecutionResult[] = [];
  const seen = new Set<string>();

  for (const row of previous.results) {
    if (updatedIds.has(row.journeyId) && replaced.has(row.journeyId)) {
      merged.push(replaced.get(row.journeyId)!);
      seen.add(row.journeyId);
    } else {
      merged.push(row);
      seen.add(row.journeyId);
    }
  }

  for (const row of newResults) {
    if (!seen.has(row.journeyId)) {
      merged.push(row);
      seen.add(row.journeyId);
    }
  }

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    executionMode,
    summary: summarizeResults(merged),
    results: merged,
  };
}
