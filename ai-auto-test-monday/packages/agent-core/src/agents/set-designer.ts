import type { ComponentRegistry, LocatorCatalog } from "../artifacts/types.js";
import { pomGenerationSchema } from "../artifacts/types.js";
import { loadLlmConfigFromEnv } from "../config.js";
import { HigressClient } from "../llm/higress-client.js";

export interface PomFile {
  fileName: string;
  content: string;
}

export async function runSetDesigner(
  registry: ComponentRegistry,
  catalog: LocatorCatalog,
): Promise<PomFile[]> {
  const llmFiles = await generateWithLlm(registry, catalog);
  if (llmFiles.length > 0) return llmFiles;
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
    `Generate Playwright Page Object Model TypeScript files. Each class takes Page in constructor. Use semantic method names. Export classes. Return JSON { files: [{ fileName, content }] }. Max 5 files.`,
    JSON.stringify({ components: summary }),
    pomGenerationSchema,
  );

  if (!result?.files?.length) return [];

  return result.files.map((f) => ({
    fileName: f.fileName.endsWith(".ts") ? f.fileName : `${f.fileName}.ts`,
    content: f.content,
  }));
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

    lines.push("");
    lines.push(`  constructor(private readonly page: Page) {`);
    for (const loc of locs.slice(0, 12)) {
      const prop = toPropName(loc.element);
      const expr = loc.priority[0]?.replace(/^page\./, "this.page.") ?? "this.page.locator('body')";
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
      content: `${lines.join("\n")}\n`,
    });
  }

  if (files.length === 0) {
    files.push({
      fileName: "BasePage.ts",
      content: `import type { Page } from '@playwright/test';\n\nexport class BasePage {\n  constructor(protected readonly page: Page) {}\n\n  async goto(url: string): Promise<void> {\n    await this.page.goto(url);\n  }\n}\n`,
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
