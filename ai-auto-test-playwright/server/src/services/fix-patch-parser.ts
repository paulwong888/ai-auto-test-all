import { AppError } from "../errors.js";

export interface FixPatch {
  file: string;
  unifiedDiff?: string;
  /** 完整文件内容；与 unifiedDiff 二选一，优先于 unifiedDiff */
  newContent?: string;
  description?: string;
}

export interface FixAnalysisOutput {
  failingTests: Array<{ tc: string; nodeId: string; error: string }>;
  analysis: string;
  patches: FixPatch[];
}

export function parseFixAnalysisJson(raw: string): FixAnalysisOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_FIX_ANALYSIS", "fix-analysis.json is not valid JSON", 422);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AppError("INVALID_FIX_ANALYSIS", "fix-analysis.json must be an object", 422);
  }

  const obj = parsed as Record<string, unknown>;
  const failingTests = Array.isArray(obj.failingTests)
    ? obj.failingTests.map((t) => {
        const item = t as Record<string, unknown>;
        return {
          tc: String(item.tc ?? ""),
          nodeId: String(item.nodeId ?? ""),
          error: String(item.error ?? ""),
        };
      })
    : [];

  const analysis = typeof obj.analysis === "string" ? obj.analysis : "";
  const patches = parsePatchesArray(obj.patches);

  return { failingTests, analysis, patches };
}

export function parsePatchesArray(value: unknown): FixPatch[] {
  if (!Array.isArray(value)) return [];

  const patches: FixPatch[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const file = typeof p.file === "string" ? p.file.trim() : "";
    const unifiedDiff = typeof p.unifiedDiff === "string" ? p.unifiedDiff : undefined;
    const newContent = typeof p.newContent === "string" ? p.newContent : undefined;
    if (!file || (!newContent && (!unifiedDiff || !unifiedDiff.includes("@@")))) {
      throw new AppError(
        "INVALID_PATCH",
        "Each patch must have file and unifiedDiff (with hunks) or newContent",
        422,
      );
    }
    patches.push({
      file,
      unifiedDiff,
      newContent,
      description: typeof p.description === "string" ? p.description : undefined,
    });
  }
  return patches;
}

export function selectPatches(patches: FixPatch[], indexes: number[]): FixPatch[] {
  return indexes.map((i) => {
    const patch = patches[i];
    if (!patch) {
      throw new AppError("PATCH_INDEX_INVALID", `Patch index ${i} not found`, 422);
    }
    return patch;
  });
}
