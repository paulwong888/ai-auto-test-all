import { query } from "../db/pool.js";
import type { FixPatch } from "../services/fix-patch-parser.js";

export interface FailingTest {
  tc: string;
  nodeId: string;
  error: string;
}

export interface FixSuggestionRecord {
  id: string;
  runId: string;
  analysisMd: string;
  failingTests: FailingTest[];
  patches: FixPatch[];
  iteration: number | null;
  createdAt: string;
}

interface FixRow {
  id: string;
  run_id: string;
  analysis_md: string;
  failing_tests: FailingTest[];
  patches: FixPatch[];
  iteration: number | null;
  created_at: Date;
}

function rowToRecord(row: FixRow): FixSuggestionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    analysisMd: row.analysis_md,
    failingTests: row.failing_tests ?? [],
    patches: row.patches ?? [],
    iteration: row.iteration,
    createdAt: row.created_at.toISOString(),
  };
}

export class FixSuggestionRepository {
  async insert(record: {
    id: string;
    runId: string;
    analysisMd: string;
    failingTests: FailingTest[];
    patches?: FixPatch[];
    iteration?: number | null;
  }): Promise<void> {
    await query(
      `INSERT INTO fix_suggestions (id, run_id, analysis_md, failing_tests, patches, iteration)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        record.id,
        record.runId,
        record.analysisMd,
        JSON.stringify(record.failingTests),
        JSON.stringify(record.patches ?? []),
        record.iteration ?? null,
      ],
    );
  }

  async findById(id: string): Promise<FixSuggestionRecord | null> {
    const result = await query<FixRow>(`SELECT * FROM fix_suggestions WHERE id = $1`, [id]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }

  async findByRunId(runId: string): Promise<FixSuggestionRecord | null> {
    const result = await query<FixRow>(
      `SELECT * FROM fix_suggestions WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [runId],
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : null;
  }
}
