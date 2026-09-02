import { query } from "../db/pool.js";
import { projectSchema, type Project } from "../schemas/project.js";

interface ProjectRow {
  id: string;
  name: string;
  repo_path: string;
  target_url: string;
  audit_profile: string | null;
  auth_mode: string;
  created_at: Date;
  updated_at: Date;
}

function rowToProject(row: ProjectRow): Project {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    repoPath: row.repo_path,
    targetUrl: row.target_url,
    auditProfile: row.audit_profile ?? undefined,
    authMode: row.auth_mode,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export class ProjectRepository {
  async count(): Promise<number> {
    const result = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM projects");
    return Number(result.rows[0]?.count ?? 0);
  }

  async findAll(): Promise<Project[]> {
    const result = await query<ProjectRow>("SELECT * FROM projects ORDER BY created_at ASC");
    return result.rows.map(rowToProject);
  }

  async findById(id: string): Promise<Project | null> {
    const result = await query<ProjectRow>("SELECT * FROM projects WHERE id = $1", [id]);
    return result.rows[0] ? rowToProject(result.rows[0]) : null;
  }

  async findByRepoPath(repoPath: string): Promise<Project | null> {
    const result = await query<ProjectRow>(
      "SELECT * FROM projects WHERE repo_path = $1 LIMIT 1",
      [repoPath],
    );
    return result.rows[0] ? rowToProject(result.rows[0]) : null;
  }

  async insert(project: Project): Promise<void> {
    await query(
      `INSERT INTO projects (id, name, repo_path, target_url, audit_profile, auth_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        project.id,
        project.name,
        project.repoPath,
        project.targetUrl,
        project.auditProfile ?? null,
        project.authMode ?? "none",
        project.createdAt,
        project.updatedAt,
      ],
    );
  }

  async update(project: Project): Promise<void> {
    await query(
      `UPDATE projects SET
         name = $2, repo_path = $3, target_url = $4, audit_profile = $5,
         auth_mode = $6, updated_at = $7
       WHERE id = $1`,
      [
        project.id,
        project.name,
        project.repoPath,
        project.targetUrl,
        project.auditProfile ?? null,
        project.authMode ?? "none",
        project.updatedAt,
      ],
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await query("DELETE FROM projects WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async upsert(project: Project): Promise<void> {
    await query(
      `INSERT INTO projects (id, name, repo_path, target_url, audit_profile, auth_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         repo_path = EXCLUDED.repo_path,
         target_url = EXCLUDED.target_url,
         audit_profile = EXCLUDED.audit_profile,
         auth_mode = EXCLUDED.auth_mode,
         updated_at = EXCLUDED.updated_at`,
      [
        project.id,
        project.name,
        project.repoPath,
        project.targetUrl,
        project.auditProfile ?? null,
        project.authMode ?? "none",
        project.createdAt,
        project.updatedAt,
      ],
    );
  }
}
