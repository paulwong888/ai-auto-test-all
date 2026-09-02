import { query } from "../db/pool.js";
import type { RunHistoryEntry } from "../services/run-history-service.types.js";

interface RunHistoryRow {
  project_id: string;
  feature_id: string;
  last_success: boolean;
  last_run_at: Date;
  playwright_attempts: number;
  failure_summary: string | null;
  last_playwright_exit_error: string | null;
}

function rowToEntry(row: RunHistoryRow): RunHistoryEntry {
  return {
    lastSuccess: row.last_success,
    lastRunAt: row.last_run_at.toISOString(),
    playwrightAttempts: row.playwright_attempts,
    ...(row.failure_summary ? { failureSummary: row.failure_summary } : {}),
    ...(row.last_playwright_exit_error
      ? { lastPlaywrightExitError: row.last_playwright_exit_error }
      : {}),
  };
}

export class RunHistoryRepository {
  async getLastFailedRun(
    projectId: string,
    featureId: string,
  ): Promise<RunHistoryEntry | null> {
    const result = await query<RunHistoryRow>(
      `SELECT * FROM run_history
       WHERE project_id = $1 AND feature_id = $2 AND last_success = false`,
      [projectId, featureId],
    );
    return result.rows[0] ? rowToEntry(result.rows[0]) : null;
  }

  async upsert(
    projectId: string,
    featureId: string,
    entry: RunHistoryEntry,
  ): Promise<void> {
    await query(
      `INSERT INTO run_history (
         project_id, feature_id, last_success, last_run_at,
         playwright_attempts, failure_summary, last_playwright_exit_error
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, feature_id) DO UPDATE SET
         last_success = EXCLUDED.last_success,
         last_run_at = EXCLUDED.last_run_at,
         playwright_attempts = EXCLUDED.playwright_attempts,
         failure_summary = EXCLUDED.failure_summary,
         last_playwright_exit_error = EXCLUDED.last_playwright_exit_error`,
      [
        projectId,
        featureId,
        entry.lastSuccess,
        entry.lastRunAt,
        entry.playwrightAttempts,
        entry.failureSummary ?? null,
        entry.lastPlaywrightExitError ?? null,
      ],
    );
  }
}
