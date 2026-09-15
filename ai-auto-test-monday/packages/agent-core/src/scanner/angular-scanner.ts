import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import type { RawComponent, InteractiveElement } from "../artifacts/types.js";
import type { ScanConfig } from "../config.js";

const SKIP_PATTERNS = [
  "**/node_modules/**",
  "**/*.spec.ts",
  "**/*.test.ts",
];

export interface ScanResult {
  components: RawComponent[];
  filesScanned: number;
  parseErrors: number;
}

function componentNameFromFile(filePath: string): string {
  const base = path.basename(filePath, ".component.html");
  return base
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function extractInteractiveFromHtml(html: string): InteractiveElement[] {
  const elements: InteractiveElement[] = [];
  const tagRegex =
    /<(button|input|a|select|textarea|form|mat-button|button)\b([^>]*)(?:\/>|>)/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[1]!.toLowerCase().replace("mat-button", "button");
    const attrs = match[2] ?? "";
    const testIdMatch = attrs.match(/data-testid=["']([^"']+)["']/);
    const ariaMatch = attrs.match(/aria-label=["']([^"']+)["']/);
    elements.push({
      elementType: tag,
      role: `${tag}Element`,
      line: html.slice(0, match.index).split("\n").length,
      existingTestId: testIdMatch?.[1],
      ariaLabel: ariaMatch?.[1],
    });
  }
  return elements;
}

export async function scanAngularProject(
  frontendPath: string,
  config: ScanConfig,
): Promise<ScanResult> {
  const patterns = [
    path.join(frontendPath, "**/*.component.html"),
    path.join(frontendPath, "**/*.html"),
  ];
  const files: string[] = [];
  for (const pattern of patterns) {
    const found = await glob(pattern, {
      ignore: SKIP_PATTERNS.map((p) => path.join(frontendPath, p)),
      nodir: true,
      absolute: true,
    });
    for (const f of found) {
      if (!f.includes(".component.") && f.includes("node_modules")) continue;
      if (!files.includes(f)) files.push(f);
    }
    if (files.length >= config.maxFiles) break;
  }

  const limited = files.slice(0, config.maxFiles);
  const components: RawComponent[] = [];
  let parseErrors = 0;

  for (const filePath of limited) {
    if (components.length >= config.maxComponents) break;
    try {
      const html = await readFile(filePath, "utf8");
      const relPath = path.relative(frontendPath, filePath);
      const interactiveElements = extractInteractiveFromHtml(html);
      if (interactiveElements.length === 0) continue;
      components.push({
        name: componentNameFromFile(filePath),
        type: "angular",
        filePath: relPath,
        interactiveElements,
      });
    } catch {
      parseErrors += 1;
    }
  }

  return { components, filesScanned: limited.length, parseErrors };
}
