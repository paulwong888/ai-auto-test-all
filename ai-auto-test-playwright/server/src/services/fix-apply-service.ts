import fs from "node:fs/promises";
import path from "node:path";
import { applyPatch } from "diff";
import { AppError } from "../errors.js";
import type { FixPatch } from "./fix-patch-parser.js";

export function assertSafeTestPath(workspacePath: string, relativeFile: string): string {
  const normalized = path.normalize(relativeFile).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!normalized.startsWith("tests/")) {
    throw new AppError("PATCH_PATH_INVALID", "Patch path must be under tests/", 422);
  }
  const abs = path.resolve(workspacePath, normalized);
  const testsRoot = path.resolve(workspacePath, "tests");
  if (!abs.startsWith(testsRoot + path.sep) && abs !== testsRoot) {
    throw new AppError("PATCH_PATH_INVALID", "Path traversal blocked", 422);
  }
  return abs;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function extractDiffLines(unifiedDiff: string, marker: "+" | "-"): string[] {
  const skip = marker === "-" ? "---" : "+++";
  return normalizeNewlines(unifiedDiff)
    .split("\n")
    .filter((line) => line.startsWith(marker) && !line.startsWith(skip))
    .map((line) => line.slice(1));
}

/** Contiguous `-` runs from the unified diff (avoids false negatives when a removed line exists elsewhere). */
function extractRemovedBlocks(unifiedDiff: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
  };

  for (const raw of normalizeNewlines(unifiedDiff).split("\n")) {
    if (raw.startsWith("-") && !raw.startsWith("---")) {
      current.push(raw.slice(1));
      continue;
    }
    flush();
  }
  flush();

  return blocks.filter((block) => block.trim());
}

/** True when unified diff hunks already match the current file (idempotent re-apply). */
export function isPatchAlreadyApplied(source: string, unifiedDiff: string): boolean {
  const normalized = normalizeNewlines(source);
  const added = extractDiffLines(unifiedDiff, "+");
  const significant = added.filter((line) => line.trim());

  if (significant.length === 0) {
    return false;
  }

  if (!significant.every((line) => normalized.includes(line))) {
    return false;
  }

  for (const block of extractRemovedBlocks(unifiedDiff)) {
    if (normalized.includes(block)) {
      return false;
    }
  }

  return true;
}

function tryApplyPatch(source: string, unifiedDiff: string): string | false {
  const normalizedSource = normalizeNewlines(source);
  const normalizedDiff = normalizeNewlines(unifiedDiff);

  try {
    for (const fuzzFactor of [2, 5]) {
      const patched = applyPatch(normalizedSource, normalizedDiff, { fuzzFactor });
      if (patched !== false) {
        return patched;
      }
    }
  } catch {
    return false;
  }

  return false;
}

export class FixApplyService {
  async applyPatches(
    workspacePath: string,
    patches: FixPatch[],
  ): Promise<{ appliedFiles: string[]; skippedFiles: string[]; backupDir: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(workspacePath, "tests/.backup", timestamp);
    const appliedFiles: string[] = [];
    const skippedFiles: string[] = [];

    for (const patch of patches) {
      const abs = assertSafeTestPath(workspacePath, patch.file);
      await fs.mkdir(path.dirname(abs), { recursive: true });

      const existed = await fs.access(abs).then(() => true).catch(() => false);
      const original = existed ? await fs.readFile(abs, "utf8") : "";

      const patched = tryApplyPatch(original, patch.unifiedDiff);
      if (patched === false) {
        if (isPatchAlreadyApplied(original, patch.unifiedDiff)) {
          skippedFiles.push(patch.file);
          continue;
        }
        throw new AppError(
          "PATCH_APPLY_FAILED",
          `Failed to apply patch to ${patch.file}`,
          422,
        );
      }

      if (patched === original) {
        skippedFiles.push(patch.file);
        continue;
      }

      const backupTarget = path.join(backupDir, patch.file);
      await fs.mkdir(path.dirname(backupTarget), { recursive: true });
      if (existed) {
        await fs.writeFile(backupTarget, original);
      }

      await fs.writeFile(abs, patched);
      appliedFiles.push(patch.file);
    }

    return { appliedFiles, skippedFiles, backupDir };
  }
}
