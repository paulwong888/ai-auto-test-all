/** Workflow-safe exports (no Node.js APIs). */

export const TASK_QUEUE = "director-pipeline";

export const WORKFLOW_NAME = "directorPipelineWorkflow";

export const PROGRESS_QUERY = "getPipelineProgress";

export const AGENT_IDS = [
  "scriptAnalyst",
  "stageManager",
  "blockingCoach",
  "setDesigner",
  "choreographer",
  "assistantDirector",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_LABELS: Record<AgentId, string> = {
  scriptAnalyst: "Script Analyst / 剧本分析师",
  stageManager: "Stage Manager / 舞台经理",
  blockingCoach: "Blocking Coach / 调度教练",
  setDesigner: "Set Designer / 布景师",
  choreographer: "Choreographer / 编舞师",
  assistantDirector: "Assistant Director / 副导演",
};

export type PipelineStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface PipelineInput {
  projectId: string;
  runId: string;
  artifactRoot: string;
  frontendPath: string;
  backendPath?: string;
  targetUrl?: string;
}

export interface PipelineProgress {
  projectId: string;
  runId: string;
  status: PipelineStatus;
  currentAgent: AgentId | null;
  completedAgents: AgentId[];
  artifactRoot: string;
  error?: string;
}

export interface AgentArtifactMeta {
  agent: AgentId;
  artifactType: string;
  filePath: string;
}
