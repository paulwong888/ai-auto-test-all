import type { PlatformPipelineInput } from "../shared/workflow-types.js";

const serverUrl = process.env.PLAYWRIGHT_SERVER_URL ?? "http://server:3001";
const internalToken = process.env.TEMPORAL_INTERNAL_TOKEN ?? "dev-temporal-internal";

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-temporal-internal-token": internalToken,
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.error?.message ?? `HTTP ${res.status} ${path}`);
  }
  return payload.data as T;
}

export async function planGenerate(input: PlatformPipelineInput): Promise<{ jobId: string }> {
  return postJson("/internal/temporal/plan", {
    projectId: input.projectId,
    moduleName: input.moduleName,
    pipelineRunId: input.pipelineRunId,
  });
}

export async function codegenGenerate(input: PlatformPipelineInput): Promise<{ jobId: string }> {
  return postJson("/internal/temporal/codegen", {
    projectId: input.projectId,
    moduleName: input.moduleName,
    pipelineRunId: input.pipelineRunId,
  });
}

export async function pytestRun(input: {
  projectId: string;
  pipelineRunId: string;
  preset?: "ci" | "debug";
  nodeIds?: string[];
  previousRunId?: string;
}): Promise<{ runId: string; status: string; passed: number; failed: number }> {
  return postJson("/internal/temporal/run", input);
}

export async function fixAnalyze(input: {
  projectId: string;
  pipelineRunId: string;
  runId: string;
  fixIteration?: number;
}): Promise<{ jobId: string; suggestionId: string }> {
  return postJson("/internal/temporal/fix/analyze", input);
}

export async function fixApply(input: {
  projectId: string;
  pipelineRunId: string;
  suggestionId: string;
}): Promise<{ appliedFiles: string[]; skippedFiles: string[] }> {
  return postJson("/internal/temporal/fix/apply", input);
}

export async function fixVerifyRun(input: {
  projectId: string;
  pipelineRunId: string;
  runId: string;
}): Promise<{ runId: string; status: string; passed: number; failed: number }> {
  return postJson("/internal/temporal/fix/verify", input);
}

export async function finalizePipeline(input: {
  pipelineRunId: string;
  status: "passed" | "failed" | "cancelled";
  runId: string | null;
  fixIteration: number;
  error: string | null;
}): Promise<void> {
  await postJson("/internal/temporal/pipeline/finish", input);
}
