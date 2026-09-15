import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { ApplyReport, ApplyPatchResult, InjectionPatch } from "../artifacts/types.js";
import { applyReactPatches } from "./react-apply.js";
import { applyTemplatePatches } from "./template-apply.js";

function detectFramework(filePath: string): "react" | "vue" | "angular" | "svelte" {
  if (filePath.endsWith(".vue")) return "vue";
  if (filePath.endsWith(".svelte")) return "svelte";
  if (filePath.endsWith(".html")) return "angular";
  return "react";
}

export async function applyTestIdPatches(
  repoRoot: string,
  patches: InjectionPatch[],
): Promise<ApplyReport> {
  const byFile = new Map<string, InjectionPatch[]>();
  for (const patch of patches) {
    const list = byFile.get(patch.file) ?? [];
    list.push(patch);
    byFile.set(patch.file, list);
  }

  const allResults: ApplyPatchResult[] = [];

  for (const [relFile, filePatches] of byFile) {
    const absPath = path.join(repoRoot, relFile);
    const fw = detectFramework(relFile);
    let fileResults: ApplyPatchResult[];
    if (fw === "react") {
      fileResults = await applyReactPatches(absPath, filePatches);
    } else {
      fileResults = await applyTemplatePatches(absPath, filePatches, fw);
    }
    allResults.push(...fileResults);
  }

  const applied = allResults.filter((r) => r.status === "applied").length;
  const skipped = allResults.filter((r) => r.status === "skipped").length;
  const failed = allResults.filter((r) => r.status === "failed").length;

  return {
    generatedAt: new Date().toISOString(),
    dryRun: false,
    applied,
    skipped,
    failed,
    results: allResults,
  };
}

export async function writeBackupMarker(
  repoRoot: string,
  runId: string,
): Promise<void> {
  const dir = path.join(repoRoot, ".monday-backup");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${runId}.marker`),
    new Date().toISOString(),
    "utf8",
  );
}
