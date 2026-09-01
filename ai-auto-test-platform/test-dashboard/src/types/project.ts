export interface Project {
  id: string;
  name: string;
  repoPath: string;
  targetUrl: string;
  auditProfile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectValidation {
  ok: boolean;
  repoExists: boolean;
  hasPiConfig: boolean;
  hasE2eDir: boolean;
  messages: string[];
}

export const SELECTED_PROJECT_KEY = "ai-test-platform:selectedProjectId";
