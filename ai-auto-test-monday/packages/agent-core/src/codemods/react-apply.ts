import { readFile, writeFile } from "node:fs/promises";
import { parse } from "@babel/parser";
import generateModule from "@babel/generator";

type GenerateFn = (
  ast: t.File,
  opts?: { retainLines?: boolean },
  code?: string,
) => { code: string };

const generate = (
  (generateModule as unknown as { default?: GenerateFn }).default ??
  (generateModule as unknown as GenerateFn)
);
import babelTraverse from "@babel/traverse";
import * as t from "@babel/types";
import type { ApplyPatchResult, InjectionPatch } from "../artifacts/types.js";

type TraverseFn = (ast: t.File, opts: Record<string, (p: unknown) => void>) => void;
const traverse = (
  (babelTraverse as unknown as { default?: TraverseFn }).default ??
  (babelTraverse as unknown as TraverseFn)
);

export async function applyReactPatches(
  absPath: string,
  patches: InjectionPatch[],
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

  let ast: t.File;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (err) {
    for (const p of actionable) {
      results.push({
        file: p.file,
        line: p.line,
        testId: p.testId,
        status: "failed",
        message: `parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return results;
  }

  const linesToPatch = new Map<number, InjectionPatch>();
  for (const p of actionable) {
    linesToPatch.set(p.line, p);
  }

  traverse(ast, {
    JSXOpeningElement(path: any) {
      const line = path.node.loc?.start.line;
      if (!line || !linesToPatch.has(line)) return;
      const patch = linesToPatch.get(line)!;
      const attrs = path.node.attributes as Array<
        t.JSXAttribute | t.JSXSpreadAttribute
      >;

      const hasTestId = attrs.some(
        (a) =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name) &&
          a.name.name === "data-testid",
      );

      if (patch.action === "inject-testid" && !hasTestId) {
        attrs.push(
          t.jsxAttribute(
            t.jsxIdentifier("data-testid"),
            t.stringLiteral(patch.testId),
          ),
        );
        results.push({
          file: patch.file,
          line: patch.line,
          testId: patch.testId,
          status: "applied",
        });
        linesToPatch.delete(line);
      } else if (
        (patch.action === "rename-existing-testid" ||
          patch.action === "resolve-conflict") &&
        hasTestId
      ) {
        for (const attr of attrs) {
          if (
            t.isJSXAttribute(attr) &&
            t.isJSXIdentifier(attr.name) &&
            attr.name.name === "data-testid" &&
            t.isStringLiteral(attr.value)
          ) {
            attr.value = t.stringLiteral(patch.testId);
            results.push({
              file: patch.file,
              line: patch.line,
              testId: patch.testId,
              status: "applied",
            });
            linesToPatch.delete(line);
          }
        }
      } else {
        results.push({
          file: patch.file,
          line: patch.line,
          testId: patch.testId,
          status: "skipped",
          message: hasTestId ? "testid already present" : "element not matched",
        });
        linesToPatch.delete(line);
      }
    },
  });

  for (const [, patch] of linesToPatch) {
    results.push({
      file: patch.file,
      line: patch.line,
      testId: patch.testId,
      status: "skipped",
      message: "no JSX element at line",
    });
  }

  const applied = results.some((r) => r.status === "applied");
  if (applied) {
    const out = generate(ast, { retainLines: true }, source);
    await writeFile(absPath, out.code, "utf8");
  }

  return results;
}
