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
