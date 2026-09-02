import { config } from "../config.js";
import { initPool, closePool } from "./pool.js";
import { runMigrations } from "./migrate.js";
import { importLegacyJsonIfEmpty, importLegacyFeatures } from "./import-legacy-storage.js";

async function main(): Promise<void> {
  await initPool(config);
  await runMigrations();
  const imported = await importLegacyJsonIfEmpty(config);
  const featureImports = await importLegacyFeatures();
  console.log(
    imported || featureImports > 0
      ? `[db:import] legacy import done (features: ${featureImports} projects)`
      : "[db:import] nothing to import",
  );
  await closePool();
}

main().catch((err) => {
  console.error("[db:import] failed:", err);
  process.exit(1);
});
