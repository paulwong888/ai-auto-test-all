import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors.js";
import type { FixPatch } from "./fix-patch-parser.js";
import { applyUnifiedDiff } from "./apply-unified-diff.js";

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

export class FixApplyService {
  async applyPatches(
    workspacePath: string,
    patches: FixPatch[],
  ): Promise<{ appliedFiles: string[]; backupDir: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(workspacePath, "tests/.backup", timestamp);
    const appliedFiles: string[] = [];

    for (const patch of patches) {
      const abs = assertSafeTestPath(workspacePath, patch.file);
      await fs.mkdir(path.dirname(abs), { recursive: true });

      const existed = await fs.access(abs).then(() => true).catch(() => false);
      const original = existed ? await fs.readFile(abs, "utf8") : "";

      const backupTarget = path.join(backupDir, patch.file);
      await fs.mkdir(path.dirname(backupTarget), { recursive: true });
      if (existed) {
        await fs.writeFile(backupTarget, original);
      }

      let nextContent: string;
      if (patch.newContent !== undefined) {
        nextContent = patch.newContent;
      } else if (patch.unifiedDiff) {
        const patched = applyUnifiedDiff(original, patch.unifiedDiff);
        if (patched === false) {
          throw new AppError(
            "PATCH_APPLY_FAILED",
            `Failed to apply patch to ${patch.file} (content may have changed; re-run analyze)`,
            422,
          );
        }
        nextContent = patched;
      } else {
        throw new AppError("INVALID_PATCH", `Patch for ${patch.file} has no diff or newContent`, 422);
      }

      if (nextContent.length === 0) {
        throw new AppError(
          "PATCH_APPLY_FAILED",
          `Refusing to write empty content to ${patch.file}`,
          422,
        );
      }

      await fs.writeFile(abs, nextContent);
      appliedFiles.push(patch.file);
    }

    return { appliedFiles, backupDir };
  }
}
