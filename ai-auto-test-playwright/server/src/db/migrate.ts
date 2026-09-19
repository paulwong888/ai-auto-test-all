import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations");

export async function runMigrations(): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const applied = await query<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [version],
    );
    if (applied.rowCount && applied.rowCount > 0) continue;

    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await query("BEGIN");
    try {
      await query(sql);
      await query(
        "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [version],
      );
      await query("COMMIT");
      console.log(`[db] applied migration ${version}`);
    } catch (err) {
      await query("ROLLBACK");
      throw err;
    }
  }
}
