import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { projectsFileSchema } from "../schemas/project.js";
import type { AuditJobState } from "../pi/types.js";
import type { RunHistoryDocument } from "../services/run-history-service.types.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { AuditJobRepository } from "../repositories/audit-job-repository.js";
import { RunHistoryRepository } from "../repositories/run-history-repository.js";

import { FeaturesRepository } from "../repositories/features-repository.js";
import { parseFeaturesDocument } from "../schemas/features.js";

export async function importLegacyFeatures(): Promise<number> {
  const projectRepo = new ProjectRepository();
  const featuresRepo = new FeaturesRepository();
  let importedProjects = 0;

  for (const project of await projectRepo.findAll()) {
    if (await featuresRepo.hasFeatureSet(project.id)) continue;

    const featuresPath = path.join(project.repoPath, "FEATURES.json");
    try {
      const raw = await fs.readFile(featuresPath, "utf8");
      const doc = parseFeaturesDocument(JSON.parse(raw));
      await featuresRepo.importDocument(project.id, doc, "import");
      console.log(
        `[db] imported ${doc.features.length} features for ${project.id} from FEATURES.json`,
      );
      importedProjects += 1;
    } catch {
      /* no file */
    }
  }

  return importedProjects;
}

export async function importLegacyJsonIfEmpty(config: AppConfig): Promise<boolean> {
  const projectRepo = new ProjectRepository();
  const count = await projectRepo.count();
  if (count > 0) return false;

  let imported = false;

  try {
    const raw = await fs.readFile(config.legacyProjectsFile, "utf8");
    const parsed = projectsFileSchema.parse(JSON.parse(raw));
    for (const project of parsed.projects) {
      await projectRepo.upsert(project);
    }
    console.log(`[db] imported ${parsed.projects.length} projects from legacy JSON`);
    imported = true;
  } catch (err) {
    console.warn("[db] legacy projects import skipped:", err instanceof Error ? err.message : err);
  }

  try {
    const entries = await fs.readdir(config.legacyAuditJobsDir);
    const auditRepo = new AuditJobRepository();
    let jobCount = 0;
    for (const file of entries) {
      if (!file.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(config.legacyAuditJobsDir, file), "utf8");
      const job = JSON.parse(raw) as AuditJobState;
      await auditRepo.save(job);
      jobCount += 1;
    }
    if (jobCount > 0) {
      console.log(`[db] imported ${jobCount} audit jobs from legacy JSON`);
      imported = true;
    }
  } catch (err) {
    console.warn("[db] legacy audit jobs import skipped:", err instanceof Error ? err.message : err);
  }

  const projects = await projectRepo.findAll();
  const historyRepo = new RunHistoryRepository();
  let historyCount = 0;
  for (const project of projects) {
    const historyPath = path.join(project.repoPath, ".pi", "run-history.json");
    try {
      const raw = await fs.readFile(historyPath, "utf8");
      const doc = JSON.parse(raw) as RunHistoryDocument;
      for (const [featureId, entry] of Object.entries(doc.byFeature ?? {})) {
        await historyRepo.upsert(project.id, featureId, entry);
        historyCount += 1;
      }
    } catch {
      /* no file */
    }
  }
  if (historyCount > 0) {
    console.log(`[db] imported ${historyCount} run history entries from legacy .pi files`);
    imported = true;
  }

  return imported;
}
