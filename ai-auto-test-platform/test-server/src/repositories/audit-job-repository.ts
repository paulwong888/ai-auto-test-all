import { query } from "../db/pool.js";
import type { AuditJobState, AuditModuleJobState } from "../pi/types.js";

interface AuditJobRow {
  id: string;
  project_id: string;
  mode: string;
  status: string;
  repo_path: string;
  current_module_id: string | null;
  feature_count: number;
  error: string | null;
  features_path: string | null;
  modules: AuditModuleJobState[] | string;
  created_at: Date;
  updated_at: Date;
}

function parseModules(raw: AuditModuleJobState[] | string): AuditModuleJobState[] {
  if (typeof raw === "string") return JSON.parse(raw) as AuditModuleJobState[];
  return raw;
}

function rowToJob(row: AuditJobRow): AuditJobState {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: "full",
    status: row.status as AuditJobState["status"],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    repoPath: row.repo_path,
    currentModuleId: row.current_module_id ?? undefined,
    modules: parseModules(row.modules),
    featureCount: row.feature_count,
    error: row.error ?? undefined,
    featuresPath: row.features_path ?? undefined,
  };
}

export class AuditJobRepository {
  async findById(id: string): Promise<AuditJobState | null> {
    const result = await query<AuditJobRow>("SELECT * FROM audit_jobs WHERE id = $1", [id]);
    return result.rows[0] ? rowToJob(result.rows[0]) : null;
  }

  async save(job: AuditJobState): Promise<void> {
    await query(
      `INSERT INTO audit_jobs (
         id, project_id, mode, status, repo_path, current_module_id,
         feature_count, error, features_path, modules, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         project_id = EXCLUDED.project_id,
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         repo_path = EXCLUDED.repo_path,
         current_module_id = EXCLUDED.current_module_id,
         feature_count = EXCLUDED.feature_count,
         error = EXCLUDED.error,
         features_path = EXCLUDED.features_path,
         modules = EXCLUDED.modules,
         updated_at = EXCLUDED.updated_at`,
      [
        job.id,
        job.projectId,
        job.mode,
        job.status,
        job.repoPath,
        job.currentModuleId ?? null,
        job.featureCount,
        job.error ?? null,
        job.featuresPath ?? null,
        JSON.stringify(job.modules),
        job.createdAt,
        job.updatedAt,
      ],
    );
  }

  async findRunningJobs(): Promise<AuditJobState[]> {
    const result = await query<AuditJobRow>(
      "SELECT * FROM audit_jobs WHERE status = 'running'",
    );
    return result.rows.map(rowToJob);
  }
}
