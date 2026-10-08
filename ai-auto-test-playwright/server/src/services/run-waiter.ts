import type { RunRecord } from "../repositories/run-repository.js";
import type { RunService } from "./run-service.js";

const TERMINAL = new Set(["passed", "failed", "cancelled", "error"]);

export async function waitForRun(
  runService: RunService,
  projectId: string,
  runId: string,
  timeoutMs = 3_600_000,
  pollMs = 5_000,
): Promise<RunRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await runService.getRun(projectId, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (TERMINAL.has(run.status)) {
      return run;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
