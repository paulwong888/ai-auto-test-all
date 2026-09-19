export type WorkflowStage = "init" | "recorded" | "plan" | "code" | "run";
export type StageStatus = "idle" | "generating" | "running" | "failed";
export type RunStatus = "pending" | "running" | "passed" | "failed" | "cancelled";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type RunPreset = "debug" | "ci" | "custom" | null;

export interface Project {
  id: string;
  name: string;
  baseUrl: string;
  workspacePath: string;
  status: string;
  workflowStage: WorkflowStage;
  stageStatus: StageStatus;
  moduleName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowState {
  projectId: string;
  workspacePath: string;
  stage: WorkflowStage;
  stageStatus: StageStatus;
  moduleName: string | null;
  artifactPaths: Record<string, unknown>;
  updatedAt: string | null;
}

export interface Job {
  id: string;
  projectId: string;
  type: "plan" | "code" | "fix" | "run" | "record";
  status: JobStatus;
  error: string | null;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  projectId: string;
  jobId: string | null;
  status: RunStatus;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number | null;
  reportPath: string | null;
  reportUrl?: string;
  options: Record<string, unknown>;
  preset?: RunPreset;
  failedNodeIds?: string[];
  parentRunId?: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface FailingTest {
  tc: string;
  nodeId: string;
  error: string;
}

export interface FixPatch {
  file: string;
  unifiedDiff: string;
  description?: string;
}

export interface FixSuggestion {
  runId: string;
  suggestionId?: string | null;
  failingTests: FailingTest[];
  analysis: string;
  patches?: FixPatch[];
  tracePaths: string[];
  iteration?: number | null;
}

export interface RunCompareResult {
  runA: string;
  runB: string;
  newFailures: string[];
  fixed: string[];
  stillFailing: string[];
  newlyPassing: string[];
}

export interface TrendPoint {
  date: string;
  total: number;
  passed: number;
  passRate: number;
}
