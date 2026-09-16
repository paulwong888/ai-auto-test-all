export type CloneStatus = "idle" | "cloning" | "ready" | "failed";

export interface E2eAuthConfig {
  username: string;
  password: string;
  caseUsername?: string;
  casePassword?: string;
  corpUsername?: string;
  corpPassword?: string;
}

export interface PublicE2eAuth {
  username: string;
  caseUsername?: string;
  corpUsername?: string;
  hasPassword: boolean;
  hasCasePassword?: boolean;
  hasCorpPassword?: boolean;
}

export interface Project {
  id: string;
  name: string;
  frontendGitUrl: string | null;
  frontendBranch: string;
  backendGitUrl: string | null;
  backendBranch: string;
  localPathOverride: string | null;
  targetUrl: string | null;
  e2eAuth: E2eAuthConfig | null;
  cloneStatus: CloneStatus;
  cloneError: string | null;
  frontendRepoPath: string | null;
  backendRepoPath: string | null;
  lastClonedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicProject = Omit<Project, "e2eAuth"> & {
  e2eAuth: PublicE2eAuth | null;
};

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
