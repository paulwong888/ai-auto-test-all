import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { pool } from "../db/pool.js";
import type { CloneStatus, Project } from "@monday/agent-core";
import { parseCloneStatus } from "@monday/agent-core";
import type { CreateProjectInput, UpdateProjectInput } from "@monday/agent-core";

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

export async function listProjects(): Promise<Project[]> {
  const { rows } = await pool.query(
    "SELECT * FROM projects ORDER BY created_at ASC",
  );
  return rows.map(rowToProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const { rows } = await pool.query("SELECT * FROM projects WHERE id = $1", [
    id,
  ]);
  return rows[0] ? rowToProject(rows[0]) : null;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
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
      clone_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'idle')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      frontend_git_url = EXCLUDED.frontend_git_url,
      frontend_branch = EXCLUDED.frontend_branch,
      backend_git_url = EXCLUDED.backend_git_url,
      backend_branch = EXCLUDED.backend_branch,
      local_path_override = EXCLUDED.local_path_override,
      target_url = EXCLUDED.target_url,
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
    ],
  );
  return rowToProject(rows[0]);
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
    ],
  );
  return rows[0] ? rowToProject(rows[0]) : null;
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

async function markReadyIfPathExists(
  projectId: string,
  repoPath: string,
): Promise<void> {
  try {
    await access(repoPath, constants.F_OK);
    await updateCloneResult(projectId, {
      status: "ready",
      error: null,
      frontendRepoPath: repoPath,
      backendRepoPath: null,
    });
  } catch {
    // path not mounted yet
  }
}

export async function seedDefaultProjects(): Promise<void> {
  await createProject({
    name: "Demo App",
    id: "demo",
    frontendBranch: "main",
    backendBranch: "main",
    targetUrl: "http://host.docker.internal:8037",
  });
  const crmPath =
    process.env.CRM_FRONTEND_PATH ??
    "/data/repos/external/casemanagement-reduxfrontend";
  await createProject({
    name: "CRM Frontend",
    id: "crm-front",
    frontendBranch: "main",
    backendBranch: "main",
    targetUrl: "http://172.26.9.212:8026",
    localPathOverride: crmPath,
  });
  await markReadyIfPathExists("crm-front", crmPath);
}
