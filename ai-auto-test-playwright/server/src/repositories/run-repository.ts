import { query } from "../db/pool.js";

export type RunStatus = "pending" | "running" | "passed" | "failed" | "cancelled";
export type RunPreset = "debug" | "ci" | "custom" | null;

export type RunTriggerSource = "web" | "ci" | "api";

export interface RunRecord {
  id: string;
  projectId: string;
  jobId: string | null;
  status: RunStatus;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number | null;
  reportPath: string | null;
  logPath: string | null;
  options: Record<string, unknown>;
  preset: RunPreset;
  failedNodeIds: string[];
  parentRunId: string | null;
  triggerSource: RunTriggerSource;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface RunRow {
  id: string;
  project_id: string;
  job_id: string | null;
  status: RunStatus;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number | null;
  report_path: string | null;
  log_path: string | null;
  options: Record<string, unknown>;
  preset: RunPreset;
  failed_node_ids: string[] | null;
  parent_run_id: string | null;
  trigger_source: RunTriggerSource | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

function rowToRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    jobId: row.job_id,
    status: row.status,
    passed: row.passed,
    failed: row.failed,
    skipped: row.skipped,
    durationMs: row.duration_ms,
    reportPath: row.report_path,
    logPath: row.log_path,
    options: row.options ?? {},
    preset: row.preset,
    failedNodeIds: row.failed_node_ids ?? [],
    parentRunId: row.parent_run_id,
    triggerSource: row.trigger_source ?? "web",
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export class RunRepository {
  async insert(run: Omit<RunRecord, "createdAt"> & { createdAt?: string }): Promise<void> {
    await query(
      `INSERT INTO runs (
         id, project_id, job_id, status, passed, failed, skipped, duration_ms,
         report_path, log_path, options, preset, failed_node_ids, parent_run_id,
         trigger_source, started_at, finished_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,COALESCE($18::timestamptz, NOW()))`,
      [
        run.id,
        run.projectId,
        run.jobId,
        run.status,
        run.passed,
        run.failed,
        run.skipped,
        run.durationMs,
        run.reportPath,
        run.logPath,
        JSON.stringify(run.options),
        run.preset,
        JSON.stringify(run.failedNodeIds),
        run.parentRunId,
        run.triggerSource ?? "web",
        run.startedAt,
        run.finishedAt,
        run.createdAt ?? null,
      ],
    );
  }

  async update(run: RunRecord): Promise<void> {
    await query(
      `UPDATE runs SET
         status = $2,
         passed = $3,
         failed = $4,
         skipped = $5,
         duration_ms = $6,
         report_path = $7,
         log_path = $8,
         options = $9,
         preset = $10,
         failed_node_ids = $11,
         parent_run_id = $12,
         started_at = $13,
         finished_at = $14
       WHERE id = $1`,
      [
        run.id,
        run.status,
        run.passed,
        run.failed,
        run.skipped,
        run.durationMs,
        run.reportPath,
        run.logPath,
        JSON.stringify(run.options),
        run.preset,
        JSON.stringify(run.failedNodeIds),
        run.parentRunId,
        run.startedAt,
        run.finishedAt,
      ],
    );
  }

  async findById(id: string): Promise<RunRecord | null> {
    const result = await query<RunRow>("SELECT * FROM runs WHERE id = $1", [id]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async listByProject(
    projectId: string,
    limit = 20,
    filters?: { status?: RunStatus; preset?: string },
  ): Promise<RunRecord[]> {
    const clauses = ["project_id = $1"];
    const params: unknown[] = [projectId];
    if (filters?.status) {
      params.push(filters.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filters?.preset) {
      params.push(filters.preset);
      clauses.push(`preset = $${params.length}`);
    }
    params.push(limit);
    const result = await query<RunRow>(
      `SELECT * FROM runs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(rowToRecord);
  }

  async trendByProject(projectId: string, days = 7): Promise<
    Array<{ date: string; total: number; passed: number; passRate: number }>
  > {
    const result = await query<{ date: string; total: string; passed: string }>(
      `SELECT
         to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS date,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE status = 'passed')::text AS passed
       FROM runs
       WHERE project_id = $1
         AND started_at >= NOW() - ($2 || ' days')::interval
         AND status IN ('passed', 'failed')
       GROUP BY 1
       ORDER BY 1 ASC`,
      [projectId, days],
    );
    return result.rows.map((row) => {
      const total = Number(row.total);
      const passed = Number(row.passed);
      return {
        date: row.date,
        total,
        passed,
        passRate: total > 0 ? passed / total : 0,
      };
    });
  }
}
