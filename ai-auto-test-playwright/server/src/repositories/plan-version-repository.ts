import { randomUUID } from "node:crypto";
import { query } from "../db/pool.js";

export type PlanVersionSource = "ai" | "user";

export interface PlanVersionRecord {
  id: string;
  projectId: string;
  moduleName: string;
  versionNumber: number;
  content: string;
  source: PlanVersionSource;
  baseVersionId: string | null;
  message: string | null;
  createdAt: string;
}

interface PlanVersionRow {
  id: string;
  project_id: string;
  module_name: string;
  version_number: number;
  content: string;
  source: PlanVersionSource;
  base_version_id: string | null;
  message: string | null;
  created_at: Date;
}

function rowToRecord(row: PlanVersionRow): PlanVersionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    moduleName: row.module_name,
    versionNumber: row.version_number,
    content: row.content,
    source: row.source,
    baseVersionId: row.base_version_id,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  };
}

export class PlanVersionRepository {
  async findById(id: string): Promise<PlanVersionRecord | null> {
    const result = await query<PlanVersionRow>("SELECT * FROM plan_versions WHERE id = $1", [id]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async getLatest(projectId: string, moduleName: string): Promise<PlanVersionRecord | null> {
    const result = await query<PlanVersionRow>(
      `SELECT * FROM plan_versions
       WHERE project_id = $1 AND module_name = $2
       ORDER BY version_number DESC
       LIMIT 1`,
      [projectId, moduleName],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async listByProjectModule(projectId: string, moduleName: string): Promise<PlanVersionRecord[]> {
    const result = await query<PlanVersionRow>(
      `SELECT * FROM plan_versions
       WHERE project_id = $1 AND module_name = $2
       ORDER BY version_number DESC`,
      [projectId, moduleName],
    );
    return result.rows.map(rowToRecord);
  }

  async saveVersion(input: {
    projectId: string;
    moduleName: string;
    content: string;
    source: PlanVersionSource;
    baseVersionId?: string | null;
    message?: string | null;
  }): Promise<PlanVersionRecord> {
    const latest = await this.getLatest(input.projectId, input.moduleName);
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const id = randomUUID();

    await query(
      `INSERT INTO plan_versions (
         id, project_id, module_name, version_number, content, source, base_version_id, message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.projectId,
        input.moduleName,
        versionNumber,
        input.content,
        input.source,
        input.baseVersionId ?? null,
        input.message ?? null,
      ],
    );

    const created = await this.findById(id);
    if (!created) {
      throw new Error("Failed to create plan version");
    }
    return created;
  }
}
