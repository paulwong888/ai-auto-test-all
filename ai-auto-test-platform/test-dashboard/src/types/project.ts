export type AuthMode = "none" | "keycloak";

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  targetUrl: string;
  auditProfile?: string;
  authMode?: AuthMode;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectValidation {
  ok: boolean;
  repoExists: boolean;
  hasPiConfig: boolean;
  hasE2eDir: boolean;
  hasPlaywrightConfig: boolean;
  hasAuthSetup: boolean;
  hasEnvE2e: boolean;
  playwrightListOk: boolean;
  messages: string[];
}

export const SELECTED_PROJECT_KEY = "ai-test-platform:selectedProjectId";
