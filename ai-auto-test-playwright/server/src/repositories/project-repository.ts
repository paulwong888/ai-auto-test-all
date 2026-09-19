import { query } from "../db/pool.js";
import type { ProjectStatus } from "./types.js";

export interface ProjectRow {
  id: string;
  name: string;
  base_url: string;
  workspace_path: string;
  status: ProjectStatus;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectRecord {
  id: string;
  name: string;
  baseUrl: string;
  workspacePath: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

function rowToRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    workspacePath: row.workspace_path,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class ProjectRepository {
  async count(): Promise<number> {
    const result = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM projects");
    return Number(result.rows[0]?.count ?? 0);
  }

  async findAll(): Promise<ProjectRecord[]> {
    const result = await query<ProjectRow>("SELECT * FROM projects ORDER BY created_at ASC");
    return result.rows.map(rowToRecord);
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const result = await query<ProjectRow>("SELECT * FROM projects WHERE id = $1", [id]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async insert(record: ProjectRecord): Promise<void> {
    await query(
      `INSERT INTO projects (id, name, base_url, workspace_path, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.id,
        record.name,
        record.baseUrl,
        record.workspacePath,
        record.status,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  async update(record: ProjectRecord): Promise<void> {
    await query(
      `UPDATE projects SET
         name = $2, base_url = $3, workspace_path = $4, status = $5, updated_at = $6
       WHERE id = $1`,
      [
        record.id,
        record.name,
        record.baseUrl,
        record.workspacePath,
        record.status,
        record.updatedAt,
      ],
    );
  }

  async delete(id: string): Promise<boolean> {
    const result = await query("DELETE FROM projects WHERE id = $1", [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
