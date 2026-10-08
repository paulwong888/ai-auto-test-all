import { query } from "../db/pool.js";
import type { PlatformPipelineStage, PlatformPipelineStatus } from "../temporal/workflow-constants.js";

export interface PlatformPipelineRunRecord {
  id: string;
  projectId: string;
  temporalWorkflowId: string;
  status: PlatformPipelineStatus;
  currentStage: PlatformPipelineStage;
  moduleName: string | null;
  runId: string | null;
  fixIteration: number;
  options: Record<string, unknown>;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
}

interface PlatformPipelineRow {
  id: string;
  project_id: string;
  temporal_workflow_id: string;
  status: PlatformPipelineStatus;
  current_stage: PlatformPipelineStage;
  module_name: string | null;
  run_id: string | null;
  fix_iteration: number;
  options: Record<string, unknown>;
  error: string | null;
  started_at: Date;
  finished_at: Date | null;
  created_at: Date;
}

function rowToRecord(row: PlatformPipelineRow): PlatformPipelineRunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    temporalWorkflowId: row.temporal_workflow_id,
    status: row.status,
    currentStage: row.current_stage,
    moduleName: row.module_name,
    runId: row.run_id,
    fixIteration: row.fix_iteration,
    options: row.options ?? {},
    error: row.error,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export class PlatformPipelineRepository {
  async insert(record: PlatformPipelineRunRecord): Promise<void> {
    await query(
      `INSERT INTO platform_pipeline_runs
        (id, project_id, temporal_workflow_id, status, current_stage, module_name, run_id, fix_iteration, options, error, started_at, finished_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        record.id,
        record.projectId,
        record.temporalWorkflowId,
        record.status,
        record.currentStage,
        record.moduleName,
        record.runId,
        record.fixIteration,
        JSON.stringify(record.options),
        record.error,
        record.startedAt,
        record.finishedAt,
        record.createdAt,
      ],
    );
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        PlatformPipelineRunRecord,
        | "status"
        | "currentStage"
        | "runId"
        | "fixIteration"
        | "error"
        | "finishedAt"
      >
    >,
  ): Promise<PlatformPipelineRunRecord | null> {
    const current = await this.findById(id);
    if (!current) return null;
    const next: PlatformPipelineRunRecord = {
      ...current,
      status: patch.status ?? current.status,
      currentStage: patch.currentStage ?? current.currentStage,
      runId: patch.runId ?? current.runId,
      fixIteration: patch.fixIteration ?? current.fixIteration,
      error: patch.error ?? current.error,
      finishedAt: patch.finishedAt ?? current.finishedAt,
    };
    await query(
      `UPDATE platform_pipeline_runs
       SET status = $2, current_stage = $3, run_id = $4, fix_iteration = $5, error = $6, finished_at = $7
       WHERE id = $1`,
      [
        next.id,
        next.status,
        next.currentStage,
        next.runId,
        next.fixIteration,
        next.error,
        next.finishedAt,
      ],
    );
    return next;
  }

  async findById(id: string): Promise<PlatformPipelineRunRecord | null> {
    const result = await query<PlatformPipelineRow>(
      "SELECT * FROM platform_pipeline_runs WHERE id = $1",
      [id],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async listByProject(projectId: string, limit = 20): Promise<PlatformPipelineRunRecord[]> {
    const result = await query<PlatformPipelineRow>(
      `SELECT * FROM platform_pipeline_runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [projectId, limit],
    );
    return result.rows.map(rowToRecord);
  }
}
