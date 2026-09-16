import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { pool } from "../db/pool.js";
import type {
  CloneStatus,
  Project,
  PublicProject,
} from "@monday/agent-core";
import {
  mergeE2eAuthUpdate,
  parseCloneStatus,
  parseE2eAuthFromRow,
} from "@monday/agent-core";
import type { CreateProjectInput, UpdateProjectInput } from "@monday/agent-core";

type CreateProjectServiceInput = Omit<CreateProjectInput, "e2eAuth"> & {
  e2eAuth?: CreateProjectInput["e2eAuth"];
};

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    frontendGitUrl: row.frontend_git_url ? String(row.frontend_git_url) : null,
    frontendBranch: String(row.frontend_branch ?? "main"),
    backendGitUrl: row.backend_git_url ? String(row.backend_git_url) : null,
    backendBranch: String(row.backend_branch ?? "main"),
    localPathOverride: row.local_path_override
      ? String(row.local_path_override)
      : null,
    targetUrl: row.target_url ? String(row.target_url) : null,
    e2eAuth: parseE2eAuthFromRow(row.e2e_auth_json),
    cloneStatus: parseCloneStatus(row.clone_status),
    cloneError: row.clone_error ? String(row.clone_error) : null,
    frontendRepoPath: row.frontend_repo_path
      ? String(row.frontend_repo_path)
      : null,
    backendRepoPath: row.backend_repo_path
      ? String(row.backend_repo_path)
      : null,
    lastClonedAt: row.last_cloned_at
      ? new Date(String(row.last_cloned_at)).toISOString()
      : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function toPublicProject(project: Project): PublicProject {
  const { e2eAuth, ...rest } = project;
  return {
    ...rest,
    e2eAuth: e2eAuth
      ? {
          username: e2eAuth.username,
          caseUsername: e2eAuth.caseUsername,
          corpUsername: e2eAuth.corpUsername,
          hasPassword: Boolean(e2eAuth.password),
          hasCasePassword: Boolean(e2eAuth.casePassword),
          hasCorpPassword: Boolean(e2eAuth.corpPassword),
        }
      : null,
  };
}

export async function listProjects(): Promise<Project[]> {
  const { rows } = await pool.query(
    "SELECT * FROM projects ORDER BY created_at ASC",
  );
  const projects = rows.map(rowToProject);
  return ensureMountProjectsReady(projects);
}

export async function getProject(id: string): Promise<Project | null> {
  const project = await fetchProjectById(id);
  if (!project) return null;
  return tryMarkMountProjectReady(project);
}

async function fetchProjectById(id: string): Promise<Project | null> {
  const { rows } = await pool.query("SELECT * FROM projects WHERE id = $1", [
    id,
  ]);
  return rows[0] ? rowToProject(rows[0]) : null;
}

export async function createProject(
  input: CreateProjectServiceInput,
): Promise<Project> {
  const id =
    input.id ??
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const { rows } = await pool.query(
    `INSERT INTO projects (
      id, name, frontend_git_url, frontend_branch,
      backend_git_url, backend_branch, local_path_override, target_url,
      e2e_auth_json, clone_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'idle')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      frontend_git_url = EXCLUDED.frontend_git_url,
      frontend_branch = EXCLUDED.frontend_branch,
      backend_git_url = EXCLUDED.backend_git_url,
      backend_branch = EXCLUDED.backend_branch,
      local_path_override = EXCLUDED.local_path_override,
      target_url = EXCLUDED.target_url,
      e2e_auth_json = EXCLUDED.e2e_auth_json,
      updated_at = NOW()
    RETURNING *`,
    [
      id,
      input.name,
      input.frontendGitUrl || null,
      input.frontendBranch,
      input.backendGitUrl || null,
      input.backendBranch,
      input.localPathOverride ?? null,
      input.targetUrl || null,
      input.e2eAuth ? JSON.stringify(input.e2eAuth) : null,
    ],
  );
  const project = rowToProject(rows[0]);
  return tryMarkMountProjectReady(project);
}

export async function updateProject(
  id: string,
  input: UpdateProjectInput,
): Promise<Project | null> {
  const existing = await getProject(id);
  if (!existing) return null;

  const name = input.name ?? existing.name;
  const frontendGitUrl =
    input.frontendGitUrl !== undefined
      ? input.frontendGitUrl || null
      : existing.frontendGitUrl;
  const frontendBranch = input.frontendBranch ?? existing.frontendBranch;
  const backendGitUrl =
    input.backendGitUrl !== undefined
      ? input.backendGitUrl || null
      : existing.backendGitUrl;
  const backendBranch = input.backendBranch ?? existing.backendBranch;
  const localPathOverride =
    input.localPathOverride !== undefined
      ? input.localPathOverride || null
      : existing.localPathOverride;
  const targetUrl =
    input.targetUrl !== undefined ? input.targetUrl || null : existing.targetUrl;

  let e2eAuth = existing.e2eAuth;
  if (input.e2eAuth !== undefined) {
    e2eAuth = mergeE2eAuthUpdate(existing.e2eAuth, input.e2eAuth);
  }

  const gitChanged =
    frontendGitUrl !== existing.frontendGitUrl ||
    backendGitUrl !== existing.backendGitUrl ||
    frontendBranch !== existing.frontendBranch ||
    backendBranch !== existing.backendBranch ||
    localPathOverride !== existing.localPathOverride;

  const cloneReset = gitChanged
    ? `, clone_status = 'idle', clone_error = NULL,
         frontend_repo_path = NULL, backend_repo_path = NULL, last_cloned_at = NULL`
    : "";

  const { rows } = await pool.query(
    `UPDATE projects SET
      name = $2,
      frontend_git_url = $3,
      frontend_branch = $4,
      backend_git_url = $5,
      backend_branch = $6,
      local_path_override = $7,
      target_url = $8,
      e2e_auth_json = $9,
      updated_at = NOW()
      ${cloneReset}
    WHERE id = $1
    RETURNING *`,
    [
      id,
      name,
      frontendGitUrl,
      frontendBranch,
      backendGitUrl,
      backendBranch,
      localPathOverride,
      targetUrl,
      e2eAuth ? JSON.stringify(e2eAuth) : null,
    ],
  );
  const project = rows[0] ? rowToProject(rows[0]) : null;
  if (!project) return null;
  return tryMarkMountProjectReady(project);
}

export async function deleteProject(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM projects WHERE id = $1", [
    id,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function setCloneStatus(
  id: string,
  status: CloneStatus,
  error: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE projects SET clone_status = $2, clone_error = $3, updated_at = NOW() WHERE id = $1`,
    [id, status, error],
  );
}

export async function updateCloneResult(
  id: string,
  result: {
    status: CloneStatus;
    error: string | null;
    frontendRepoPath: string | null;
    backendRepoPath: string | null;
  },
): Promise<void> {
  await pool.query(
    `UPDATE projects SET
      clone_status = $2,
      clone_error = $3,
      frontend_repo_path = $4,
      backend_repo_path = $5,
      last_cloned_at = CASE WHEN $2 = 'ready' THEN NOW() ELSE last_cloned_at END,
      updated_at = NOW()
    WHERE id = $1`,
    [
      id,
      result.status,
      result.error,
      result.frontendRepoPath,
      result.backendRepoPath,
    ],
  );
}

export function isMountOnlyProject(project: {
  localPathOverride?: string | null;
  frontendGitUrl?: string | null;
  backendGitUrl?: string | null;
}): boolean {
  const override = project.localPathOverride?.trim();
  if (!override) return false;
  const hasGit =
    Boolean(project.frontendGitUrl?.trim()) ||
    Boolean(project.backendGitUrl?.trim());
  return !hasGit;
}

/** Mount 型项目：路径存在则自动 ready，无需手动 Clone */
export async function tryMarkMountProjectReady(
  project: Project,
): Promise<Project> {
  if (!isMountOnlyProject(project)) return project;
  if (project.cloneStatus === "cloning") return project;

  const repoPath = project.localPathOverride!.trim();
  try {
    await access(repoPath, constants.F_OK);
  } catch {
    return project;
  }

  if (project.cloneStatus === "ready" && project.frontendRepoPath === repoPath) {
    return project;
  }

  await updateCloneResult(project.id, {
    status: "ready",
    error: null,
    frontendRepoPath: repoPath,
    backendRepoPath: null,
  });
  return (await fetchProjectById(project.id)) ?? {
    ...project,
    cloneStatus: "ready",
    cloneError: null,
    frontendRepoPath: repoPath,
    backendRepoPath: null,
  };
}

async function ensureMountProjectsReady(projects: Project[]): Promise<Project[]> {
  const updated = await Promise.all(
    projects.map((p) => tryMarkMountProjectReady(p)),
  );
  return updated;
}

async function syncAllMountProjectsReady(): Promise<void> {
  const { rows } = await pool.query("SELECT * FROM projects ORDER BY created_at ASC");
  await ensureMountProjectsReady(rows.map(rowToProject));
}

/** 仅首次安装时插入占位项目；不覆盖 UI/DB 中已有配置 */
async function ensureDefaultProject(input: {
  id: string;
  name: string;
  targetUrl?: string;
}): Promise<void> {
  const existing = await fetchProjectById(input.id);
  if (existing) return;
  await createProject({
    id: input.id,
    name: input.name,
    frontendBranch: "main",
    backendBranch: "main",
    targetUrl: input.targetUrl,
  });
}

export async function seedDefaultProjects(): Promise<void> {
  await ensureDefaultProject({
    id: "demo",
    name: "Demo App",
    targetUrl: "http://host.docker.internal:8037",
  });
  await ensureDefaultProject({
    id: "crm-front",
    name: "CRM Frontend",
    targetUrl: "http://172.26.9.212:8026",
  });
  await syncAllMountProjectsReady();
}
