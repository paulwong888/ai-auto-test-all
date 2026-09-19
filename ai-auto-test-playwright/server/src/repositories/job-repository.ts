import { query } from "../db/pool.js";

export type JobType = "plan" | "code" | "fix" | "run" | "record";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  error: string | null;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface JobRow {
  id: string;
  project_id: string;
  type: JobType;
  status: JobStatus;
  error: string | null;
  result: Record<string, unknown> | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

function rowToRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    error: row.error,
    result: row.result,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export class JobRepository {
  async insert(job: Omit<JobRecord, "createdAt"> & { createdAt?: string }): Promise<void> {
    await query(
      `INSERT INTO jobs (id, project_id, type, status, error, result, started_at, finished_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()))`,
      [
        job.id,
        job.projectId,
        job.type,
        job.status,
        job.error,
        job.result ? JSON.stringify(job.result) : null,
        job.startedAt,
        job.finishedAt,
        job.createdAt ?? null,
      ],
    );
  }

  async update(job: JobRecord): Promise<void> {
    await query(
      `UPDATE jobs
       SET status = $2, error = $3, result = $4, started_at = $5, finished_at = $6
       WHERE id = $1`,
      [
        job.id,
        job.status,
        job.error,
        job.result ? JSON.stringify(job.result) : null,
        job.startedAt,
        job.finishedAt,
      ],
    );
  }

  async findById(id: string): Promise<JobRecord | null> {
    const result = await query<JobRow>("SELECT * FROM jobs WHERE id = $1", [id]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async findActiveByProject(projectId: string, type: JobType): Promise<JobRecord | null> {
    const result = await query<JobRow>(
      `SELECT * FROM jobs
       WHERE project_id = $1 AND type = $2 AND status IN ('pending', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId, type],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }
}
