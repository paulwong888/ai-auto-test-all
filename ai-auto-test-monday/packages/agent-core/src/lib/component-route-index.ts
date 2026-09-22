import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import type {
  ComponentRegistry,
  RouteConfigDocument,
  RouteEntry,
} from "../artifacts/types.js";
import {
  inferComponentNameFromFile,
  isPascalCase,
  jsxTagName,
  parseSourceFile,
  traverse,
} from "../scanner/babel-utils.js";
import { componentNameFromPomClass } from "./pipeline-batch.js";

function routeSpecificity(path: string): number {
  const paramCount = (path.match(/[:*]/g) ?? []).length;
  return paramCount * 1000 - path.length;
}

export function pickBestRoute(routes: RouteEntry[]): RouteEntry | undefined {
  if (routes.length === 0) return undefined;
  return [...routes].sort((a, b) => routeSpecificity(a.path) - routeSpecificity(b.path))[0];
}

export function indexRoutesByComponent(
  routes: RouteEntry[],
): Map<string, RouteEntry[]> {
  const index = new Map<string, RouteEntry[]>();
  for (const route of routes) {
    const list = index.get(route.component) ?? [];
    list.push(route);
    index.set(route.component, list);
  }
  return index;
}

function collectHostGraphSourceFiles(
  registry: ComponentRegistry,
  routes: RouteEntry[],
  frontendPath: string,
): string[] {
  const files = new Set<string>();

  for (const comp of registry.components) {
    files.add(path.join(frontendPath, comp.filePath));
  }

  for (const route of routes) {
    if (route.sourceFile) {
      files.add(path.join(frontendPath, route.sourceFile));
    }
    for (const ext of [".js", ".jsx", ".tsx"]) {
      const matches = globSync(
        `**/${route.component}${ext}`,
        {
          cwd: path.join(frontendPath, "src"),
          absolute: true,
          nodir: true,
          ignore: ["**/node_modules/**"],
        },
      );
      for (const match of matches) {
        files.add(match);
      }
    }
  }

  return [...files].filter((file) => existsSync(file));
}

export function buildJsxParentMap(
  registry: ComponentRegistry,
  frontendPath: string,
  routes: RouteEntry[] = [],
): Map<string, Set<string>> {
  const childToParents = new Map<string, Set<string>>();
  const sourceFiles = collectHostGraphSourceFiles(registry, routes, frontendPath);

  for (const absPath of sourceFiles) {
    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const parentName = inferComponentNameFromFile(source, absPath);
    let ast;
    try {
      ast = parseSourceFile(source);
    } catch {
      continue;
    }

    traverse(ast, {
      JSXOpeningElement(pathNode: any) {
        const childName = jsxTagName(pathNode.node.name);
        if (!childName || !isPascalCase(childName)) return;
        if (childName === parentName) return;

        const parents = childToParents.get(childName) ?? new Set<string>();
        parents.add(parentName);
        childToParents.set(childName, parents);
      },
    });
  }

  return childToParents;
}

function findHostComponentWithRoute(
  componentName: string,
  childToParents: Map<string, Set<string>>,
  routeIndex: Map<string, RouteEntry[]>,
): string | undefined {
  const queue = [componentName];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (routeIndex.has(current)) return current;

    for (const parent of childToParents.get(current) ?? []) {
      if (!visited.has(parent)) queue.push(parent);
    }
  }

  return undefined;
}

export function resolveNavigatePathForComponent(
  componentName: string,
  routes: RouteEntry[],
  registry: ComponentRegistry,
): string | undefined {
  const routeIndex = indexRoutesByComponent(routes);
  const direct = pickBestRoute(routeIndex.get(componentName) ?? []);
  if (direct) return direct.path;

  const childToParents = buildJsxParentMap(
    registry,
    registry.frontendPath,
    routes,
  );
  const hostComponent = findHostComponentWithRoute(
    componentName,
    childToParents,
    routeIndex,
  );
  if (!hostComponent) return undefined;

  const hostRoute = pickBestRoute(routeIndex.get(hostComponent) ?? []);
  return hostRoute?.path;
}

export function resolveNavigatePath(
  pomClass: string,
  routeConfig: RouteConfigDocument | undefined,
  registry: ComponentRegistry,
): string | undefined {
  if (!routeConfig?.routes.length) return undefined;
  const componentName = componentNameFromPomClass(pomClass);
  return resolveNavigatePathForComponent(
    componentName,
    routeConfig.routes,
    registry,
  );
}

export function buildComponentRoutesMap(
  registry: ComponentRegistry,
  routes: RouteEntry[],
): Record<string, string[]> {
  const routeIndex = indexRoutesByComponent(routes);
  const childToParents = buildJsxParentMap(
    registry,
    registry.frontendPath,
    routes,
  );
  const result: Record<string, string[]> = {};

  for (const comp of registry.components) {
    const paths = new Set<string>();
    const direct = routeIndex.get(comp.name) ?? [];
    for (const route of direct) {
      paths.add(route.path);
    }

    const hostComponent = findHostComponentWithRoute(
      comp.name,
      childToParents,
      routeIndex,
    );
    if (hostComponent) {
      const hostRoute = pickBestRoute(routeIndex.get(hostComponent) ?? []);
      if (hostRoute) paths.add(hostRoute.path);
    }

    if (paths.size > 0) {
      result[comp.name] = [...paths].sort();
    }
  }

  return result;
}

function splitNavigatePath(raw: string): { pathname: string; suffix: string } {
  const qIdx = raw.indexOf("?");
  const hIdx = raw.indexOf("#");
  const cut =
    qIdx >= 0 && hIdx >= 0
      ? Math.min(qIdx, hIdx)
      : qIdx >= 0
        ? qIdx
        : hIdx >= 0
          ? hIdx
          : raw.length;
  return { pathname: raw.slice(0, cut), suffix: raw.slice(cut) };
}

export function resolveJourneyNavigatePaths(
  journeys: import("../artifacts/types.js").Journey[],
  routeConfig: RouteConfigDocument | undefined,
  registry: ComponentRegistry,
): import("../artifacts/types.js").Journey[] {
  if (!routeConfig?.routes.length) return journeys;

  return journeys.map((journey) => {
    const navStep = journey.steps.find(
      (s) => s.action === "navigate" && s.method === "navigateTo",
    );
    if (!navStep?.args?.length) return journey;

    const raw = String(navStep.args[0]);
    const { pathname, suffix } = splitNavigatePath(raw);
    const resolved = resolveNavigatePath(navStep.pom, routeConfig, registry);
    if (!resolved || resolved === pathname) return journey;

    console.info(
      `[journey-normalize] fixed navigate ${journey.id}: ${pathname} -> ${resolved}`,
    );

    const steps = journey.steps.map((step) => {
      if (step !== navStep) return step;
      return { ...step, args: [`${resolved}${suffix}`] };
    });

    return { ...journey, steps };
  });
}
