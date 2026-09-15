import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
});

export async function migrate(): Promise<void> {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = [
    "001_init.sql",
    "002_clone_status.sql",
    "003_execution.sql",
    "004_overlay_workflow.sql",
    "005_run_options.sql",
  ];
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
  }
}

export async function checkDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
