export const PLAYWRIGHT_PLATFORM_WORKFLOW_NAME = "playwrightPlatformWorkflow";
export const PLAYWRIGHT_PLATFORM_TASK_QUEUE = "playwright-platform";
export const PLATFORM_PROGRESS_QUERY = "getPlatformProgress";

export type PlatformPipelineStage =
  | "starting"
  | "plan"
  | "codegen"
  | "run"
  | "fix_analyze"
  | "fix_apply"
  | "fix_verify"
  | "done";

export type PlatformPipelineStatus = "running" | "passed" | "failed" | "cancelled";

export interface PlatformProgress {
  pipelineRunId: string;
  projectId: string;
  stage: PlatformPipelineStage;
  status: PlatformPipelineStatus;
  runId?: string | null;
  jobId?: string | null;
  fixIteration?: number;
  error?: string | null;
}

export interface PlatformPipelineInput {
  projectId: string;
  pipelineRunId: string;
  moduleName: string;
  runPreset?: "ci" | "debug";
  nodeIds?: string[];
  autoFix?: boolean;
  maxFixIterations?: number;
  skipPlan?: boolean;
  skipCodegen?: boolean;
}
