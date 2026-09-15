import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { glob } from "glob";
import type { RawComponent } from "../artifacts/types.js";
import type { ScanConfig } from "../config.js";
import { scanReactProject } from "./react-scanner.js";
import { scanVueProject } from "./vue-scanner.js";
import { scanAngularProject } from "./angular-scanner.js";
import { scanSvelteProject } from "./svelte-scanner.js";

export interface ProjectScanResult {
  components: RawComponent[];
  filesScanned: number;
  parseErrors: number;
  frameworks: string[];
}

async function countByExt(root: string, ext: string): Promise<number> {
  const files = await glob(path.join(root, `**/*${ext}`), {
    ignore: ["**/node_modules/**"],
    nodir: true,
  });
  return files.length;
}

async function detectFrameworks(frontendPath: string): Promise<string[]> {
  const counts = await Promise.all([
    countByExt(frontendPath, ".tsx").then((n) => n + 0),
    countByExt(frontendPath, ".jsx"),
    countByExt(frontendPath, ".vue"),
    countByExt(frontendPath, ".svelte"),
    countByExt(frontendPath, ".component.html"),
  ]);

  const frameworks: string[] = [];
  if (counts[0]! + counts[1]! > 0) frameworks.push("react");
  if (counts[2]! > 0) frameworks.push("vue");
  if (counts[4]! > 0) frameworks.push("angular");
  if (counts[3]! > 0) frameworks.push("svelte");

  if (frameworks.length === 0) {
    try {
      await access(path.join(frontendPath, "package.json"), constants.F_OK);
      frameworks.push("react");
    } catch {
      frameworks.push("react");
    }
  }
  return frameworks;
}

function mergeComponents(all: RawComponent[], config: ScanConfig): RawComponent[] {
  const seen = new Set<string>();
  const merged: RawComponent[] = [];
  for (const comp of all) {
    const key = `${comp.filePath}:${comp.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(comp);
    if (merged.length >= config.maxComponents) break;
  }
  return merged;
}

export async function scanProject(
  frontendPath: string,
  config: ScanConfig,
): Promise<ProjectScanResult> {
  const frameworks = await detectFrameworks(frontendPath);
  const allComponents: RawComponent[] = [];
  let filesScanned = 0;
  let parseErrors = 0;

  const runners: Array<{ fw: string; run: () => Promise<{ components: RawComponent[]; filesScanned: number; parseErrors: number }> }> = [];

  if (frameworks.includes("react")) {
    runners.push({ fw: "react", run: () => scanReactProject(frontendPath, config) });
  }
  if (frameworks.includes("vue")) {
    runners.push({ fw: "vue", run: () => scanVueProject(frontendPath, config) });
  }
  if (frameworks.includes("angular")) {
    runners.push({ fw: "angular", run: () => scanAngularProject(frontendPath, config) });
  }
  if (frameworks.includes("svelte")) {
    runners.push({ fw: "svelte", run: () => scanSvelteProject(frontendPath, config) });
  }

  for (const { run } of runners) {
    const result = await run();
    allComponents.push(...result.components);
    filesScanned += result.filesScanned;
    parseErrors += result.parseErrors;
  }

  return {
    components: mergeComponents(allComponents, config),
    filesScanned,
    parseErrors,
    frameworks,
  };
}

export { scanReactProject } from "./react-scanner.js";
export { scanVueProject } from "./vue-scanner.js";
export { scanAngularProject } from "./angular-scanner.js";
export { scanSvelteProject } from "./svelte-scanner.js";
