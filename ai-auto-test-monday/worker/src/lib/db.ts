import pg from "pg";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? 5433),
      database: process.env.POSTGRES_DB ?? "ai_auto_test_monday",
      user: process.env.POSTGRES_USER ?? "postgres",
      password: process.env.POSTGRES_PASSWORD ?? "postgres",
    });
  }
  return pool;
}

export async function updateExecutionStatus(
  runId: string,
  status: "pending" | "running" | "completed" | "failed",
  executionMode?: string,
): Promise<void> {
  try {
    if (executionMode) {
      await getPool().query(
        `UPDATE pipeline_runs SET execution_status = $2, execution_mode = $3 WHERE id = $1`,
        [runId, status, executionMode],
      );
    } else {
      await getPool().query(
        `UPDATE pipeline_runs SET execution_status = $2 WHERE id = $1`,
        [runId, status],
      );
    }
  } catch (err) {
    console.warn("[db] updateExecutionStatus failed:", err);
  }
}

export async function clearRunCurrentAgent(
  runId: string,
  clearOverlay = false,
): Promise<void> {
  try {
    if (clearOverlay) {
      await getPool().query(
        `UPDATE pipeline_runs SET current_agent = NULL, overlay_workflow_id = NULL WHERE id = $1`,
        [runId],
      );
    } else {
      await getPool().query(
        `UPDATE pipeline_runs SET current_agent = NULL WHERE id = $1`,
        [runId],
      );
    }
  } catch (err) {
    console.warn("[db] clearRunCurrentAgent failed:", err);
  }
}

export async function insertArtifactIndex(
  runId: string,
  agent: string,
  artifactType: string,
  filePath: string,
  summary?: Record<string, unknown>,
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO artifacts_index (run_id, agent, artifact_type, file_path, summary_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, agent, artifactType, filePath, summary ?? null],
    );
  } catch (err) {
    console.warn("[db] insertArtifactIndex failed:", err);
  }
}
