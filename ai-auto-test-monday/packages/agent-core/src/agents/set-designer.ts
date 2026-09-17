import path from "node:path";
import type {
  ComponentRegistry,
  ComponentEntry,
  LocatorCatalog,
} from "../artifacts/types.js";
import { pomGenerationSchema } from "../artifacts/types.js";
import { loadLlmConfigFromEnv, loadPipelineScaleConfigFromEnv } from "../config.js";
import { HigressClient } from "../llm/higress-client.js";
import {
  chunk,
  componentNameFromPomFile,
  componentsWithElements,
} from "../lib/pipeline-batch.js";
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

function dedupePomFiles(files: PomFile[]): PomFile[] {
  const seen = new Set<string>();
  const out: PomFile[] = [];
  for (const file of files) {
    if (seen.has(file.fileName)) continue;
    seen.add(file.fileName);
    out.push(file);
  }
  return out;
}

function buildComponentSummary(
  components: ComponentEntry[],
  catalog: LocatorCatalog,
) {
  return components.map((c) => ({
    name: c.name,
    filePath: c.filePath,
    elements: catalog.locators
      .filter((l) => l.component === c.name)
      .slice(0, 8)
      .map((l) => ({ element: l.element, locator: l.priority[0] })),
  }));
}

function normalizeLlmPomFiles(
  files: { fileName: string; content: string }[],
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
): PomFile[] {
  return files
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

async function generateWithLlmBatch(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
  components: ComponentEntry[],
  batchIndex: number,
  batchCount: number,
): Promise<PomFile[]> {
  const summary = buildComponentSummary(components, catalog);
  const llm = new HigressClient(loadLlmConfigFromEnv(), "setDesigner");
  console.info(
    `[setDesigner] batch ${batchIndex}/${batchCount} components=${components.map((c) => c.name).join(",")}`,
  );

  const result = await llm.chatJson(
    `Generate Playwright Page Object Model TypeScript files. Each class declares "private readonly page: Page;" as a field and assigns it explicitly in the constructor body: "constructor(page: Page) { this.page = page; ... }". Do NOT use TypeScript parameter properties (e.g. constructor(private readonly page: Page)) — they break at runtime. Use semantic method names. Export classes. Return JSON { files: [{ fileName, content }] }. Generate exactly ${components.length} POM files, one per component.`,
    JSON.stringify({ components: summary }),
    pomGenerationSchema,
  );

  if (!result?.files?.length) return [];
  return normalizeLlmPomFiles(result.files, registry, catalog);
}

async function generateWithLlmBatched(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
  batchSize: number,
): Promise<PomFile[]> {
  const targets = componentsWithElements(registry);
  if (targets.length === 0) return [];

  const batches = chunk(targets, batchSize);
  const merged: PomFile[] = [];

  for (let i = 0; i < batches.length; i += 1) {
    try {
      const files = await generateWithLlmBatch(
        registry,
        catalog,
        batches[i]!,
        i + 1,
        batches.length,
      );
      merged.push(...files);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[setDesigner] batch ${i + 1}/${batches.length} LLM failed: ${reason}`,
      );
    }
  }

  return dedupePomFiles(merged);
}

function generateDeterministicForComponents(
  components: ComponentEntry[],
  catalog: LocatorCatalog,
): PomFile[] {
  const files: PomFile[] = [];

  for (const comp of components) {
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
    lines.push("  constructor(page: Page) {");
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

    lines.push("  async waitForReady(): Promise<void> {");
    lines.push("    await this.page.waitForLoadState('domcontentloaded');");
    lines.push("  }");
    lines.push("");

    lines.push("}");

    files.push({
      fileName: `${comp.name}Page.ts`,
      content: repairPomContent(`${lines.join("\n")}\n`, comp.name, catalog),
    });
  }

  return files;
}

function generateDeterministic(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
): PomFile[] {
  const files = generateDeterministicForComponents(
    componentsWithElements(registry),
    catalog,
  );

  if (files.length === 0) {
    files.push({
      fileName: "BasePage.ts",
      content: `import type { Page } from '@playwright/test';\n\nexport class BasePage {\n  protected readonly page: Page;\n\n  constructor(page: Page) {\n    this.page = page;\n  }\n\n  async goto(url: string): Promise<void> {\n    await this.page.goto(url);\n  }\n}\n`,
    });
  }

  return files;
}

export async function runSetDesigner(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
): Promise<PomFile[]> {
  const scale = loadPipelineScaleConfigFromEnv();
  const targets = componentsWithElements(registry);
  if (targets.length === 0) {
    return generateDeterministic(registry, catalog);
  }

  let llmFiles: PomFile[] = [];
  try {
    llmFiles = await generateWithLlmBatched(
      registry,
      catalog,
      scale.pomBatchSize,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[setDesigner] batched LLM failed: ${reason}`);
  }

  const covered = new Set(
    llmFiles.map((f) => componentNameFromPomFile(f.fileName)),
  );
  const missing = targets.filter((c) => !covered.has(c.name));
  const fallback = generateDeterministicForComponents(missing, catalog);
  const merged = dedupePomFiles([...llmFiles, ...fallback]);

  console.info(
    `[setDesigner] poms total=${merged.length} llm=${llmFiles.length} fallback=${fallback.length}`,
  );

  if (merged.length === 0) {
    return generateDeterministic(registry, catalog);
  }

  return merged;
}

function toPropName(role: string): string {
  return role.replace(/[^a-zA-Z0-9]/g, "_");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
