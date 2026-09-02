import type { AppConfig } from "../config.js";
import { initPool } from "./pool.js";
import { runMigrations } from "./migrate.js";
import { importLegacyJsonIfEmpty, importLegacyFeatures } from "./import-legacy-storage.js";

export async function initDatabase(config: AppConfig): Promise<void> {
  await initPool(config);
  await runMigrations();
  await importLegacyJsonIfEmpty(config);
  const featureImports = await importLegacyFeatures();
  if (featureImports > 0) {
    console.log(`[db] legacy features imported for ${featureImports} project(s)`);
  }
}
