export type CloneStatus = "idle" | "cloning" | "ready" | "failed";

export interface Project {
  id: string;
  name: string;
  frontendGitUrl: string | null;
  frontendBranch: string;
  backendGitUrl: string | null;
  backendBranch: string;
  localPathOverride: string | null;
  targetUrl: string | null;
  cloneStatus: CloneStatus;
  cloneError: string | null;
  frontendRepoPath: string | null;
  backendRepoPath: string | null;
  lastClonedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  temporalWorkflowId: string;
  status: string;
  currentAgent: string | null;
  artifactRoot: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ResolvedProjectPaths {
  frontendPath: string;
  backendPath: string | null;
  source: "override" | "cloned";
}
