import { query } from "../db/pool.js";
import type { FixPatch } from "../services/fix-patch-parser.js";

export interface FixIterationRecord {
  id: string;
  runId: string;
  iteration: number;
  suggestionId: string | null;
  patchesApplied: FixPatch[];
  verifyRunId: string | null;
  result: "passed" | "failed" | "skipped" | null;
  createdAt: string;
}

interface FixIterationRow {
  id: string;
  run_id: string;
  iteration: number;
  suggestion_id: string | null;
  patches_applied: FixPatch[];
  verify_run_id: string | null;
  result: "passed" | "failed" | "skipped" | null;
  created_at: Date;
}

function rowToRecord(row: FixIterationRow): FixIterationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    iteration: row.iteration,
    suggestionId: row.suggestion_id,
    patchesApplied: row.patches_applied ?? [],
    verifyRunId: row.verify_run_id,
    result: row.result,
    createdAt: row.created_at.toISOString(),
  };
}

export class FixIterationRepository {
  async insert(record: {
    id: string;
    runId: string;
    iteration: number;
    suggestionId: string | null;
    patchesApplied: FixPatch[];
    verifyRunId?: string | null;
    result?: "passed" | "failed" | "skipped" | null;
  }): Promise<void> {
    await query(
      `INSERT INTO fix_iterations
         (id, run_id, iteration, suggestion_id, patches_applied, verify_run_id, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        record.id,
        record.runId,
        record.iteration,
        record.suggestionId,
        JSON.stringify(record.patchesApplied),
        record.verifyRunId ?? null,
        record.result ?? null,
      ],
    );
  }

  async updateResult(id: string, verifyRunId: string, result: "passed" | "failed" | "skipped"): Promise<void> {
    await query(
      `UPDATE fix_iterations SET verify_run_id = $2, result = $3 WHERE id = $1`,
      [id, verifyRunId, result],
    );
  }

  async countByRunId(runId: string): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fix_iterations WHERE run_id = $1`,
      [runId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listByRunId(runId: string): Promise<FixIterationRecord[]> {
    const result = await query<FixIterationRow>(
      `SELECT * FROM fix_iterations WHERE run_id = $1 ORDER BY iteration ASC`,
      [runId],
    );
    return result.rows.map(rowToRecord);
  }

  async getLatestIteration(runId: string): Promise<number> {
    const result = await query<{ max: number | null }>(
      `SELECT MAX(iteration) AS max FROM fix_iterations WHERE run_id = $1`,
      [runId],
    );
    return result.rows[0]?.max ?? 0;
  }
}
