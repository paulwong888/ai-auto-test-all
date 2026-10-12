import { query } from "../db/pool.js";

export interface ProjectEnvRow {
  project_id: string;
  plain_vars: Record<string, string>;
  encrypted_vars: Record<string, string>;
  updated_at: Date;
}

export class ProjectEnvRepository {
  async findByProjectId(projectId: string): Promise<ProjectEnvRow | null> {
    const result = await query<{
      project_id: string;
      plain_vars: Record<string, string>;
      encrypted_vars: Record<string, string>;
      updated_at: Date;
    }>("SELECT project_id, plain_vars, encrypted_vars, updated_at FROM project_env_settings WHERE project_id = $1", [
      projectId,
    ]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      project_id: row.project_id,
      plain_vars: row.plain_vars ?? {},
      encrypted_vars: row.encrypted_vars ?? {},
      updated_at: row.updated_at,
    };
  }

  async upsert(
    projectId: string,
    plainVars: Record<string, string>,
    encryptedVars: Record<string, string>,
  ): Promise<void> {
    await query(
      `INSERT INTO project_env_settings (project_id, plain_vars, encrypted_vars, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, now())
       ON CONFLICT (project_id) DO UPDATE SET
         plain_vars = EXCLUDED.plain_vars,
         encrypted_vars = EXCLUDED.encrypted_vars,
         updated_at = now()`,
      [projectId, JSON.stringify(plainVars), JSON.stringify(encryptedVars)],
    );
  }

  async delete(projectId: string): Promise<void> {
    await query("DELETE FROM project_env_settings WHERE project_id = $1", [projectId]);
  }
}
