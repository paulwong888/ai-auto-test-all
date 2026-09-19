import { query } from "../db/pool.js";
import type { StageStatus, WorkflowStage } from "./types.js";

export interface WorkflowStateRecord {
  projectId: string;
  stage: WorkflowStage;
  stageStatus: StageStatus;
  moduleName: string | null;
  artifactPaths: Record<string, unknown>;
  updatedAt: string;
}

interface WorkflowStateRow {
  project_id: string;
  stage: WorkflowStage;
  stage_status: StageStatus;
  module_name: string | null;
  artifact_paths: Record<string, unknown>;
  updated_at: Date;
}

function rowToRecord(row: WorkflowStateRow): WorkflowStateRecord {
  return {
    projectId: row.project_id,
    stage: row.stage,
    stageStatus: row.stage_status,
    moduleName: row.module_name,
    artifactPaths: row.artifact_paths ?? {},
    updatedAt: row.updated_at.toISOString(),
  };
}

export class WorkflowStateRepository {
  async findByProjectId(projectId: string): Promise<WorkflowStateRecord | null> {
    const result = await query<WorkflowStateRow>(
      "SELECT * FROM workflow_states WHERE project_id = $1",
      [projectId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async insertInitial(projectId: string): Promise<void> {
    await query(
      `INSERT INTO workflow_states (project_id, stage, stage_status, module_name, artifact_paths)
       VALUES ($1, 'init', 'idle', NULL, '{}'::jsonb)`,
      [projectId],
    );
  }

  async update(
    projectId: string,
    patch: Partial<
      Pick<WorkflowStateRecord, "stage" | "stageStatus" | "moduleName" | "artifactPaths">
    >,
  ): Promise<WorkflowStateRecord> {
    const current = await this.findByProjectId(projectId);
    if (!current) {
      throw new Error(`Workflow state not found for project ${projectId}`);
    }

    const next = {
      stage: patch.stage ?? current.stage,
      stageStatus: patch.stageStatus ?? current.stageStatus,
      moduleName: patch.moduleName !== undefined ? patch.moduleName : current.moduleName,
      artifactPaths: patch.artifactPaths ?? current.artifactPaths,
    };

    const result = await query<WorkflowStateRow>(
      `UPDATE workflow_states
       SET stage = $2, stage_status = $3, module_name = $4, artifact_paths = $5, updated_at = NOW()
       WHERE project_id = $1
       RETURNING *`,
      [
        projectId,
        next.stage,
        next.stageStatus,
        next.moduleName,
        JSON.stringify(next.artifactPaths),
      ],
    );

    return rowToRecord(result.rows[0]!);
  }
}
