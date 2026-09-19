import type { RunRecord } from "../repositories/run-repository.js";
import { extractTcNumber } from "../utils/pytest-node-ids.js";

export interface RunCompareResult {
  runA: string;
  runB: string;
  newFailures: string[];
  fixed: string[];
  stillFailing: string[];
  newlyPassing: string[];
}

function tcSetFromRun(run: RunRecord, kind: "failed" | "passed"): Set<string> {
  const tcs = new Set<string>();
  if (kind === "failed") {
    for (const nodeId of run.failedNodeIds) {
      const tc = extractTcNumber(nodeId);
      if (tc) tcs.add(tc);
    }
  } else if (run.status === "passed" && run.passed > 0) {
    for (let i = 1; i <= run.passed + run.failed; i++) {
      tcs.add(`TC-${String(i).padStart(3, "0")}`);
    }
    for (const nodeId of run.failedNodeIds) {
      const tc = extractTcNumber(nodeId);
      if (tc) tcs.delete(tc);
    }
  }
  return tcs;
}

export function compareRuns(runA: RunRecord, runB: RunRecord): RunCompareResult {
  const failedA = tcSetFromRun(runA, "failed");
  const failedB = tcSetFromRun(runB, "failed");

  const newFailures = [...failedB].filter((tc) => !failedA.has(tc));
  const fixed = [...failedA].filter((tc) => !failedB.has(tc));
  const stillFailing = [...failedA].filter((tc) => failedB.has(tc));

  const passedA = new Set<string>();
  const passedB = new Set<string>();
  for (const nodeId of runA.failedNodeIds) {
    const tc = extractTcNumber(nodeId);
    if (tc) failedA.add(tc);
  }
  for (const nodeId of runB.failedNodeIds) {
    const tc = extractTcNumber(nodeId);
    if (tc) failedB.add(tc);
  }

  const newlyPassing = fixed.filter((tc) => !newFailures.includes(tc));

  return {
    runA: runA.id,
    runB: runB.id,
    newFailures,
    fixed,
    stillFailing,
    newlyPassing,
  };
}
