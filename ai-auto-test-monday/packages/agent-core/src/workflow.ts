/** Workflow-safe exports (no Node.js APIs). */

export const TASK_QUEUE = "director-pipeline";

export const WORKFLOW_NAME = "directorPipelineWorkflow";

export const EXECUTE_WORKFLOW_NAME = "continuityLeadOnlyWorkflow";

export const RESUME_WORKFLOW_NAME = "resumePipelineWorkflow";

export const PROGRESS_QUERY = "getPipelineProgress";

export const EXECUTE_PROGRESS_QUERY = "getExecuteProgress";

export const AGENT_IDS = [
  "scriptAnalyst",
  "stageManager",
  "blockingCoach",
  "setDesigner",
  "choreographer",
  "assistantDirector",
  "continuityLead",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_LABELS: Record<AgentId, string> = {
  scriptAnalyst: "Script Analyst / 剧本分析师",
  stageManager: "Stage Manager / 舞台经理",
  blockingCoach: "Blocking Coach / 调度教练",
  setDesigner: "Set Designer / 布景师",
  choreographer: "Choreographer / 编舞师",
  assistantDirector: "Assistant Director / 副导演",
  continuityLead: "Continuity Lead / 场记",
};

export type PipelineStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ExecutionMode = "auto" | "platform" | "direct";

export interface PipelineE2eAuth {
  username: string;
  password: string;
  caseUsername?: string;
  casePassword?: string;
  corpUsername?: string;
  corpPassword?: string;
}

export interface PipelineInput {
  projectId: string;
  runId: string;
  artifactRoot: string;
  frontendPath: string;
  backendPath?: string;
  targetUrl?: string;
  e2eAuth?: PipelineE2eAuth;
  applyTestIds?: boolean;
  executeAfterGenerate?: boolean;
  executionMode?: ExecutionMode;
  journeyIds?: string[];
  startFromAgent?: AgentId;
}

export interface PipelineProgress {
  projectId: string;
  runId: string;
  status: PipelineStatus;
  currentAgent: AgentId | null;
  completedAgents: AgentId[];
  artifactRoot: string;
  error?: string;
  executeAfterGenerate?: boolean;
  skippedAgents?: AgentId[];
}

export interface AgentArtifactMeta {
  agent: AgentId;
  artifactType: string;
  filePath: string;
}
