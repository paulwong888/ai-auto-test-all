import type { AppConfig } from "../config.js";
import { initPool } from "./pool.js";
import { runMigrations } from "./migrate.js";

export async function initDatabase(config: AppConfig): Promise<void> {
  await initPool(config);
  await runMigrations();
}
