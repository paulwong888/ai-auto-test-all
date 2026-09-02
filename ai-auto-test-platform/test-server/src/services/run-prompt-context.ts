import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { getLastFailedRun, type RunHistoryEntry } from "./run-history-service.js";
import { specRelPath } from "./run-prompt.js";

const PRIORITY_SPEC_FILES = [
  "core_case-create-case-from-search.spec.ts",
  "core_case-search-case-by-params.spec.ts",
  "core_case-home-overview-by-role.spec.ts",
];

export interface RunPromptContext {
  specRelPath: string;
  specExists: boolean;
  referenceSpecs: string[];
  lastRun: RunHistoryEntry | null;
}

export async function loadRunPromptContext(
  repoPath: string,
  featureId: string,
  config: AppConfig,
  projectId?: string,
): Promise<RunPromptContext> {
  const specRelPathValue = specRelPath(featureId);
  const e2eDir = path.join(repoPath, "tests/e2e");
  const currentFileName = path.basename(specRelPathValue);

  let specExists = false;
  try {
    await fs.access(path.join(repoPath, specRelPathValue));
    specExists = true;
  } catch {
    /* missing */
  }

  let allSpecFiles: string[] = [];
  try {
    const entries = await fs.readdir(e2eDir);
    allSpecFiles = entries.filter((f) => f.endsWith(".spec.ts") && f !== currentFileName);
  } catch {
    /* no e2e dir */
  }

  const limit = config.runReferenceSpecLimit;
  const picked: string[] = [];
  const remaining = new Set(allSpecFiles);

  for (const priority of PRIORITY_SPEC_FILES) {
    if (priority === currentFileName) continue;
    if (remaining.has(priority) && picked.length < limit) {
      picked.push(`tests/e2e/${priority}`);
      remaining.delete(priority);
    }
  }

  const rest = [...remaining].sort();
  for (const file of rest) {
    if (picked.length >= limit) break;
    picked.push(`tests/e2e/${file}`);
  }

  const lastRun =
    projectId ? await getLastFailedRun(projectId, featureId) : null;

  return {
    specRelPath: specRelPathValue,
    specExists,
    referenceSpecs: picked,
    lastRun,
  };
}
