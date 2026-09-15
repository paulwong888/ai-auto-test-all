import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { parse as parseSfc } from "@vue/compiler-sfc";
import type { RawComponent, InteractiveElement } from "../artifacts/types.js";
import type { ScanConfig } from "../config.js";

const INTERACTIVE_TAGS = new Set([
  "button",
  "input",
  "a",
  "select",
  "textarea",
  "form",
]);

const SKIP_PATTERNS = [
  "**/node_modules/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
];

export interface ScanResult {
  components: RawComponent[];
  filesScanned: number;
  parseErrors: number;
}

function componentNameFromFile(filePath: string): string {
  const base = path.basename(filePath, ".vue");
  return base
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function extractFromTemplate(
  template: string,
  relPath: string,
): InteractiveElement[] {
  const elements: InteractiveElement[] = [];
  const tagRegex =
    /<(button|input|a|select|textarea|form)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(template)) !== null) {
    const tag = match[1]!.toLowerCase();
    const attrs = match[2] ?? "";
    const testIdMatch = attrs.match(/data-testid=["']([^"']+)["']/);
    const ariaMatch = attrs.match(/aria-label=["']([^"']+)["']/);
    const line =
      template.slice(0, match.index).split("\n").length;
    elements.push({
      elementType: tag,
      role: `${tag}Element`,
      line,
      existingTestId: testIdMatch?.[1],
      ariaLabel: ariaMatch?.[1],
      attributes: { file: relPath },
    });
  }
  if (elements.length === 0 && INTERACTIVE_TAGS.size > 0) {
    const selfClosing = /<(button|input|a|select|textarea)\b([^/>]*)\/>/gi;
    while ((match = selfClosing.exec(template)) !== null) {
      const tag = match[1]!.toLowerCase();
      const attrs = match[2] ?? "";
      const testIdMatch = attrs.match(/data-testid=["']([^"']+)["']/);
      const ariaMatch = attrs.match(/aria-label=["']([^"']+)["']/);
      elements.push({
        elementType: tag,
        role: `${tag}Element`,
        line: template.slice(0, match.index).split("\n").length,
        existingTestId: testIdMatch?.[1],
        ariaLabel: ariaMatch?.[1],
      });
    }
  }
  return elements;
}

export async function scanVueProject(
  frontendPath: string,
  config: ScanConfig,
): Promise<ScanResult> {
  const pattern = path.join(frontendPath, "**/*.vue");
  const files = await glob(pattern, {
    ignore: SKIP_PATTERNS.map((p) => path.join(frontendPath, p)),
    nodir: true,
    absolute: true,
  });

  const limited = files.slice(0, config.maxFiles);
  const components: RawComponent[] = [];
  let parseErrors = 0;

  for (const filePath of limited) {
    if (components.length >= config.maxComponents) break;
    try {
      const source = await readFile(filePath, "utf8");
      const { descriptor } = parseSfc(source, { filename: filePath });
      const template = descriptor.template?.content ?? "";
      const relPath = path.relative(frontendPath, filePath);
      const interactiveElements = extractFromTemplate(template, relPath);
      if (interactiveElements.length === 0 && !template) continue;
      components.push({
        name: componentNameFromFile(filePath),
        type: "vue",
        filePath: relPath,
        interactiveElements,
      });
    } catch {
      parseErrors += 1;
    }
  }

  return { components, filesScanned: limited.length, parseErrors };
}
