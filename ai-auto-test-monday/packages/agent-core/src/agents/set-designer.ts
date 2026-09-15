import path from "node:path";
import type { ComponentRegistry, LocatorCatalog } from "../artifacts/types.js";
import { pomGenerationSchema } from "../artifacts/types.js";
import { loadLlmConfigFromEnv } from "../config.js";
import { HigressClient } from "../llm/higress-client.js";
import {
  expectedPomFileName,
  normalizePomExportClass,
  pickLocatorExpr,
  pomFileNameToClassName,
  repairPomContent,
} from "../lib/pom-utils.js";

/** LLM may return source paths — normalize to flat `{Component}Page.ts`. */
export function sanitizePomFileName(raw: string, componentName?: string): string {
  if (componentName) {
    return expectedPomFileName(componentName);
  }
  const base = path.basename(raw.replace(/\\/g, "/"));
  const stripped = base
    .replace(/\.(tsx?|jsx|vue|svelte|html)\.ts$/i, ".ts")
    .replace(/\.(tsx?|jsx|vue|svelte|html)$/i, "");
  const safe = stripped.replace(/[^a-zA-Z0-9_-]/g, "") || "Component";
  const classStem = safe.endsWith("Page") ? safe : `${safe}Page`;
  return `${classStem}.ts`;
}

function matchComponentForPomFile(
  rawFileName: string,
  registry: ComponentRegistry,
): string | undefined {
  const base = path.basename(rawFileName.replace(/\\/g, "/")).toLowerCase();
  return registry.components.find((c) => {
    const name = c.name.toLowerCase();
    return base.includes(name) || base.includes(`${name}page`);
  })?.name;
}

export interface PomFile {
  fileName: string;
  content: string;
}

export async function runSetDesigner(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
): Promise<PomFile[]> {
  try {
    const llmFiles = await generateWithLlm(registry, catalog);
    if (llmFiles.length > 0) return llmFiles;
  } catch {
    // fall through to deterministic POMs
  }
  return generateDeterministic(registry, catalog);
}

async function generateWithLlm(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
): Promise<PomFile[]> {
  const topComponents = registry.components
    .filter((c) => c.interactiveElements.length > 0)
    .slice(0, 5);

  const summary = topComponents.map((c) => ({
    name: c.name,
    filePath: c.filePath,
    elements: catalog.locators
      .filter((l) => l.component === c.name)
      .slice(0, 8)
      .map((l) => ({ element: l.element, locator: l.priority[0] })),
  }));

  const llm = new HigressClient(loadLlmConfigFromEnv());
  const result = await llm.chatJson(
    `Generate Playwright Page Object Model TypeScript files. Each class declares "private readonly page: Page;" as a field and assigns it explicitly in the constructor body: "constructor(page: Page) { this.page = page; ... }". Do NOT use TypeScript parameter properties (e.g. constructor(private readonly page: Page)) — they break at runtime. Use semantic method names. Export classes. Return JSON { files: [{ fileName, content }] }. Max 5 files.`,
    JSON.stringify({ components: summary }),
    pomGenerationSchema,
  );

  if (!result?.files?.length) return [];

  return result.files
    .filter((f) => f.content?.trim())
    .map((f) => {
      const componentName = matchComponentForPomFile(f.fileName, registry);
      const fileName = sanitizePomFileName(f.fileName, componentName);
      const className = pomFileNameToClassName(fileName);
      const normalized = normalizePomExportClass(f.content, className);
      return {
        fileName,
        content: repairPomContent(
          normalized,
          componentName ?? className.replace(/Page$/, ""),
          catalog,
        ),
      };
    });
}

function generateDeterministic(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
): PomFile[] {
  const files: PomFile[] = [];

  const withElements = registry.components.filter(
    (c) => c.interactiveElements.length > 0,
  );

  for (const comp of withElements.slice(0, 8)) {
    const locs = catalog.locators.filter((l) => l.component === comp.name);
    if (!locs.length) continue;

    const className = `${comp.name}Page`;
    const lines: string[] = [
      "import type { Page, Locator } from '@playwright/test';",
      "",
      `export class ${className} {`,
    ];

    for (const loc of locs.slice(0, 12)) {
      const prop = toPropName(loc.element);
      lines.push(`  readonly ${prop}: Locator;`);
    }
    lines.push("  private readonly page: Page;");

    lines.push("");
    lines.push(`  constructor(page: Page) {`);
    lines.push("    this.page = page;");
    for (const loc of locs.slice(0, 12)) {
      const prop = toPropName(loc.element);
      const expr = pickLocatorExpr(loc);
      lines.push(`    this.${prop} = ${expr};`);
    }
    lines.push("  }");
    lines.push("");

    const firstButton = locs.find((l) => l.element.includes("button"));
    if (firstButton) {
      const prop = toPropName(firstButton.element);
      lines.push(`  async click${capitalize(comp.name)}Action(): Promise<void> {`);
      lines.push(`    await this.${prop}.click();`);
      lines.push("  }");
      lines.push("");
    }

    lines.push("}");

    files.push({
      fileName: `${comp.name}Page.ts`,
      content: repairPomContent(`${lines.join("\n")}\n`, comp.name, catalog),
    });
  }

  if (files.length === 0) {
    files.push({
      fileName: "BasePage.ts",
      content: `import type { Page } from '@playwright/test';\n\nexport class BasePage {\n  protected readonly page: Page;\n\n  constructor(page: Page) {\n    this.page = page;\n  }\n\n  async goto(url: string): Promise<void> {\n    await this.page.goto(url);\n  }\n}\n`,
    });
  }

  return files;
}

function toPropName(role: string): string {
  return role.replace(/[^a-zA-Z0-9]/g, "_");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
