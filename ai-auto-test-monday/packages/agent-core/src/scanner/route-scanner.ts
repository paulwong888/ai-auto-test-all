import path from "node:path";
import * as t from "@babel/types";
import type { RouteConfigDocument, RouteEntry, NavLink } from "../artifacts/types.js";
import type { ScanConfig } from "../config.js";
import { loadRouteScanConfigFromEnv } from "../config.js";
import {
  collectRouteSourceFiles,
  extractRouteElementName,
  inferComponentNameFromFile,
  jsxAttrStringValue,
  jsxTagName,
  readAndParseFile,
  traverse,
} from "./babel-utils.js";

export interface RouteScanResult {
  routes: RouteEntry[];
  navLinks: NavLink[];
}

function extractRequiresFeatureFlag(pathNode: {
  parentPath?: { node: t.Node; parentPath?: { node: t.Node; parentPath?: unknown } };
}): string | undefined {
  let current = pathNode.parentPath;
  while (current) {
    const node = current.node;
    if (t.isLogicalExpression(node) && node.operator === "&&") {
      const left = node.left;
      if (t.isIdentifier(left)) return left.name;
    }
    if (
      t.isJSXExpressionContainer(node) &&
      t.isLogicalExpression(node.expression) &&
      node.expression.operator === "&&"
    ) {
      const left = node.expression.left;
      if (t.isIdentifier(left)) return left.name;
    }
    current = current.parentPath as typeof current | undefined;
  }
  return undefined;
}

function collectRouteFromJsx(
  opening: t.JSXOpeningElement,
  relPath: string,
  routes: RouteEntry[],
  requiresFeatureFlag?: string,
): void {
  const tag = jsxTagName(opening.name);
  if (tag !== "Route") return;

  let routePath: string | null = null;
  let component: string | null = null;

  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
    if (attr.name.name === "path") {
      routePath = jsxAttrStringValue(attr.value);
    }
    if (attr.name.name === "element" || attr.name.name === "component") {
      component = extractRouteElementName(attr.value);
    }
  }

  if (!routePath || !component) return;

  routes.push({
    path: routePath,
    component,
    public: requiresFeatureFlag ? false : true,
    requiresFeatureFlag,
    sourceFile: relPath,
    line: opening.loc?.start.line,
  });
}

function collectNavLinkFromJsx(
  opening: t.JSXOpeningElement,
  fromComponent: string,
  relPath: string,
  navLinks: NavLink[],
): void {
  const tag = jsxTagName(opening.name);

  let linkToPath: string | null = null;
  let testId: string | undefined;

  for (const attr of opening.attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
    if (attr.name.name === "linkTo") {
      linkToPath = jsxAttrStringValue(attr.value);
    }
    if (attr.name.name === "data-testid") {
      testId = jsxAttrStringValue(attr.value) ?? undefined;
    }
  }

  if (linkToPath?.startsWith("/")) {
    navLinks.push({
      fromComponent,
      toPath: linkToPath,
      testId,
      sourceFile: relPath,
    });
  }

  if (!tag) return;

  if (tag === "Link") {
    let toPath: string | null = null;
    let linkTestId: string | undefined;

    for (const attr of opening.attributes) {
      if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
      if (attr.name.name === "to") {
        toPath = jsxAttrStringValue(attr.value);
      }
      if (attr.name.name === "data-testid") {
        linkTestId = jsxAttrStringValue(attr.value) ?? undefined;
      }
    }

    if (toPath?.startsWith("/")) {
      navLinks.push({
        fromComponent,
        toPath,
        testId: linkTestId,
        sourceFile: relPath,
      });
    }
    return;
  }

  if (tag === "a") {
    let href: string | null = null;
    let anchorTestId: string | undefined;

    for (const attr of opening.attributes) {
      if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
      if (attr.name.name === "href") {
        href = jsxAttrStringValue(attr.value);
      }
      if (attr.name.name === "data-testid") {
        anchorTestId = jsxAttrStringValue(attr.value) ?? undefined;
      }
    }

    if (href?.startsWith("/")) {
      navLinks.push({
        fromComponent,
        toPath: href,
        testId: anchorTestId,
        sourceFile: relPath,
      });
    }
  }
}

async function scanFileForRoutes(
  filePath: string,
  frontendPath: string,
  routes: RouteEntry[],
  navLinks: NavLink[],
): Promise<void> {
  const parsed = await readAndParseFile(filePath);
  if (!parsed) return;

  const { ast, source } = parsed;
  const relPath = path.relative(frontendPath, filePath);
  const fromComponent = inferComponentNameFromFile(source, filePath);

  traverse(ast, {
    JSXOpeningElement(pathNode: any) {
      const requiresFeatureFlag = extractRequiresFeatureFlag(pathNode);
      collectRouteFromJsx(pathNode.node, relPath, routes, requiresFeatureFlag);
      collectNavLinkFromJsx(pathNode.node, fromComponent, relPath, navLinks);
    },
  });
}

function dedupeRoutes(routes: RouteEntry[]): RouteEntry[] {
  const seen = new Set<string>();
  const result: RouteEntry[] = [];
  for (const route of routes) {
    const key = `${route.path}:${route.component}:${route.requiresFeatureFlag ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(route);
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function dedupeNavLinks(links: NavLink[]): NavLink[] {
  const seen = new Set<string>();
  const result: NavLink[] = [];
  for (const link of links) {
    const key = `${link.fromComponent}:${link.toPath}:${link.testId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

export async function extractRouteConfig(
  frontendPath: string,
  _config?: ScanConfig,
): Promise<RouteScanResult> {
  const routeScanConfig = loadRouteScanConfigFromEnv();
  const files = await collectRouteSourceFiles(
    frontendPath,
    routeScanConfig.maxFiles,
  );
  const routes: RouteEntry[] = [];
  const navLinks: NavLink[] = [];

  for (const filePath of files) {
    await scanFileForRoutes(filePath, frontendPath, routes, navLinks);
  }

  return {
    routes: dedupeRoutes(routes),
    navLinks: dedupeNavLinks(navLinks),
  };
}

export async function buildRouteConfigDocument(
  frontendPath: string,
  config?: ScanConfig,
): Promise<Omit<RouteConfigDocument, "version" | "generatedAt">> {
  const scan = await extractRouteConfig(frontendPath, config);
  return {
    framework: "react-router",
    routes: scan.routes,
    navLinks: scan.navLinks.length ? scan.navLinks : undefined,
  };
}
