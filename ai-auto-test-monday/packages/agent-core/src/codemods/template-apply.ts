import { readFile, writeFile } from "node:fs/promises";
import type { ApplyPatchResult, InjectionPatch } from "../artifacts/types.js";

function injectOnLine(
  lines: string[],
  lineNo: number,
  testId: string,
  action: InjectionPatch["action"],
): { ok: boolean; message?: string } {
  const idx = lineNo - 1;
  if (idx < 0 || idx >= lines.length) {
    return { ok: false, message: "line out of range" };
  }
  let line = lines[idx]!;

  if (line.includes(`data-testid="${testId}"`) || line.includes(`data-testid='${testId}'`)) {
    return { ok: false, message: "already has testid" };
  }

  if (action === "rename-existing-testid" || action === "resolve-conflict") {
    const replaced = line.replace(
      /data-testid=["'][^"']+["']/,
      `data-testid="${testId}"`,
    );
    if (replaced !== line) {
      lines[idx] = replaced;
      return { ok: true };
    }
  }

  const tagMatch = line.match(/<(button|input|a|select|textarea|form|mat-button)\b([^/>]*)(\/?>)/i);
  if (!tagMatch) {
    return { ok: false, message: "no opening tag on line" };
  }

  const [, tag, attrs, end] = tagMatch;
  if (/data-testid=/.test(attrs)) {
    return { ok: false, message: "testid already present" };
  }

  const newTag = `<${tag}${attrs} data-testid="${testId}"${end}`;
  lines[idx] = line.replace(tagMatch[0], newTag);
  return { ok: true };
}

export async function applyTemplatePatches(
  absPath: string,
  patches: InjectionPatch[],
  framework: "vue" | "angular" | "svelte",
): Promise<ApplyPatchResult[]> {
  const results: ApplyPatchResult[] = [];
  const actionable = patches.filter(
    (p) =>
      p.action === "inject-testid" ||
      p.action === "rename-existing-testid" ||
      p.action === "resolve-conflict",
  );
  if (actionable.length === 0) return results;

  let source: string;
  try {
    source = await readFile(absPath, "utf8");
  } catch (err) {
    for (const p of actionable) {
      results.push({
        file: p.file,
        line: p.line,
        testId: p.testId,
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return results;
  }

  const lines = source.split("\n");
  let changed = false;

  for (const patch of actionable) {
    const before = lines.join("\n");
    const result = injectOnLine(lines, patch.line, patch.testId, patch.action);
    if (result.ok) {
      changed = changed || lines.join("\n") !== before;
      results.push({
        file: patch.file,
        line: patch.line,
        testId: patch.testId,
        status: "applied",
      });
    } else {
      results.push({
        file: patch.file,
        line: patch.line,
        testId: patch.testId,
        status: "skipped",
        message: result.message ?? `unsupported ${framework} patch`,
      });
    }
  }

  if (changed) {
    await writeFile(absPath, lines.join("\n"), "utf8");
  }

  return results;
}
