import type { ComponentEntry, PageKind } from "../artifacts/types.js";
import type { ScanConfig } from "../config.js";

function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

export function isPageComponent(comp: ComponentEntry): boolean {
  const normalized = comp.filePath.replace(/\\/g, "/");
  return (
    normalized.includes("/pages/") ||
    normalized.startsWith("pages/") ||
    comp.name.endsWith("Page")
  );
}

export function inferPageKind(comp: ComponentEntry): PageKind {
  if (comp.pageKind) return comp.pageKind;
  if (comp.excludeFromPom) return "provider";
  if (comp.interactiveElements.length > 0 || comp.state?.length) {
    return "interactive";
  }
  if (isPageComponent(comp)) return "read-only";
  return "layout";
}

/** NF-01 + page retention rules after AST scan. */
export function filterRegistryComponents(
  components: ComponentEntry[],
  scanConfig: ScanConfig,
): ComponentEntry[] {
  const withKind = components
    .filter((c) => isPascalCase(c.name))
    .map((c) => ({
      ...c,
      pageKind: inferPageKind(c),
    }));

  const filtered = withKind.filter((c) => {
    if (c.excludeFromPom) return true;
    if (isPageComponent(c) && scanConfig.includeReadOnlyPages) return true;
    return c.interactiveElements.length > 0 || (c.state?.length ?? 0) > 0;
  });

  return filtered.length > 0 ? filtered : withKind;
}

export function countReadOnlyPages(components: ComponentEntry[]): number {
  return components.filter((c) => inferPageKind(c) === "read-only").length;
}

export function countFeatureFlags(components: ComponentEntry[]): number {
  return components.reduce((sum, c) => sum + (c.featureFlags?.length ?? 0), 0);
}
