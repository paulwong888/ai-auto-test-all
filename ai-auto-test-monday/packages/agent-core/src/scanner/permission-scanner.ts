import path from "node:path";
import * as t from "@babel/types";
import type { GuardEntry, PermissionModelDocument, RouteEntry } from "../artifacts/types.js";
import type { ScanConfig } from "../config.js";
import { loadScanConfigFromEnv } from "../config.js";
import {
  collectFrontendSourceFiles,
  extractRouteElementName,
  inferComponentNameFromFile,
  jsxAttrStringValue,
  jsxTagName,
  readAndParseFile,
  traverse,
} from "./babel-utils.js";

const ROUTE_GUARD_COMPONENTS = new Set([
  "ProtectedRoute",
  "RequireAuth",
  "PrivateRoute",
  "AuthGuard",
]);

const AUTH_NEGATION_PATTERN =
  /!(?:user|isAuthenticated|authenticated|token|auth|session|loggedIn)/i;

const DEFAULT_ROLES = ["guest", "authenticated"];

export interface PermissionScanResult {
  roles: string[];
  guards: GuardEntry[];
}

function isLoginComponent(name: string, relPath: string): boolean {
  return /login/i.test(name) || /login/i.test(relPath);
}

function isRouteGuardWrapper(componentName: string | null): boolean {
  return componentName != null && ROUTE_GUARD_COMPONENTS.has(componentName);
}

function unwrapRouteElement(value: t.JSXAttribute["value"] | null | undefined): t.JSXElement | null {
  if (!value || !t.isJSXExpressionContainer(value)) return null;
  const expr = value.expression;
  if (!t.isJSXElement(expr)) return null;

  const tag = jsxTagName(expr.openingElement.name);
  if (tag && ROUTE_GUARD_COMPONENTS.has(tag)) {
    for (const child of expr.children) {
      if (t.isJSXElement(child)) return child;
    }
    return null;
  }
  return expr;
}

function extractNavigateTarget(
  node: t.CallExpression,
  source: string,
): string | null {
  const callee = node.callee;
  let isNavigate = false;

  if (t.isIdentifier(callee) && callee.name === "navigate") {
    isNavigate = true;
  } else if (
    t.isMemberExpression(callee) &&
    t.isIdentifier(callee.property) &&
    callee.property.name === "navigate"
  ) {
    isNavigate = true;
  }

  if (!isNavigate) return null;

  const firstArg = node.arguments[0];
  if (t.isStringLiteral(firstArg)) return firstArg.value;
  if (firstArg?.start != null && firstArg?.end != null) {
    const text = source.slice(firstArg.start, firstArg.end);
    const match = text.match(/^["'](\/[^"']+)["']$/);
    if (match) return match[1]!;
  }
  return null;
}

async function scanRouteGuardsInFile(
  filePath: string,
  frontendPath: string,
  guards: GuardEntry[],
): Promise<void> {
  const relPath = path.relative(frontendPath, filePath);
  const parsed = await readAndParseFile(filePath);
  if (!parsed) return;

  const { ast, source } = parsed;

  traverse(ast, {
    JSXOpeningElement(pathNode: any) {
      const tag = jsxTagName(pathNode.node.name);
      if (!tag) return;

      if (tag === "Route") {
        let routePath: string | null = null;
        let routeComponentAttr: t.JSXAttribute | null = null;

        for (const attr of pathNode.node.attributes) {
          if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
          if (attr.name.name === "path") {
            routePath = jsxAttrStringValue(attr.value);
          }
          if (attr.name.name === "element" || attr.name.name === "component") {
            routeComponentAttr = attr;
          }
        }

        if (!routePath || !routeComponentAttr) return;

        const wrapped = unwrapRouteElement(routeComponentAttr.value);
        const elementName = extractRouteElementName(routeComponentAttr.value);
        if (isRouteGuardWrapper(elementName) || (wrapped && isRouteGuardWrapper(jsxTagName(wrapped.openingElement.name)))) {
          guards.push({
            route: routePath,
            allowedRoles: ["authenticated"],
            guardType: "route-guard",
            unauthenticatedBehavior: "redirect-to-login",
            evidence: `Route ${routePath} wrapped by auth guard component`,
            sourceFile: relPath,
          });
        }
      }

      if (tag === "Navigate") {
        let toPath: string | null = null;
        for (const attr of pathNode.node.attributes) {
          if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
          if (attr.name.name === "to") {
            toPath = jsxAttrStringValue(attr.value);
          }
        }
        if (toPath !== "/login") return;

        const parent = pathNode.parentPath?.node;
        let conditionText = "";
        if (
          parent &&
          (t.isConditionalExpression(parent) ||
            t.isLogicalExpression(parent) ||
            t.isIfStatement(parent))
        ) {
          const testNode = t.isIfStatement(parent)
            ? parent.test
            : (parent as t.ConditionalExpression).test ??
              (parent as t.LogicalExpression).left;
          if (testNode?.start != null && testNode?.end != null) {
            conditionText = source.slice(testNode.start, testNode.end);
          }
        }

        if (conditionText && !AUTH_NEGATION_PATTERN.test(conditionText)) return;
      }
    },
  });
}

async function scanBusinessFlowGuards(
  filePath: string,
  frontendPath: string,
  guards: GuardEntry[],
): Promise<void> {
  const relPath = path.relative(frontendPath, filePath);
  const parsed = await readAndParseFile(filePath);
  if (!parsed) return;

  const { ast, source } = parsed;
  const componentName = inferComponentNameFromFile(source, filePath);
  if (!isLoginComponent(componentName, relPath)) return;

  const navigateTargets = new Set<string>();

  traverse(ast, {
    CallExpression(pathNode: any) {
      const target = extractNavigateTarget(pathNode.node, source);
      if (target?.startsWith("/")) {
        navigateTargets.add(target);
      }
    },
  });

  for (const target of navigateTargets) {
    guards.push({
      route: target,
      allowedRoles: ["authenticated"],
      guardType: "business-flow",
      unauthenticatedBehavior: "redirect-to-login",
      evidence: `${componentName} success navigates to ${target}`,
      sourceFile: relPath,
    });
  }
}

function dedupeGuards(guards: GuardEntry[]): GuardEntry[] {
  const byRoute = new Map<string, GuardEntry>();
  for (const guard of guards) {
    const existing = byRoute.get(guard.route);
    if (!existing) {
      byRoute.set(guard.route, guard);
      continue;
    }
    if (existing.guardType === "route-guard") continue;
    if (guard.guardType === "route-guard") {
      byRoute.set(guard.route, guard);
    }
  }
  return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
}

function buildSummary(
  guards: GuardEntry[],
  publicRouteCount: number,
): PermissionModelDocument["summary"] {
  return {
    routeGuardCount: guards.filter((g) => g.guardType === "route-guard").length,
    businessFlowCount: guards.filter((g) => g.guardType === "business-flow").length,
    publicRouteCount,
  };
}

export async function extractPermissionModel(
  frontendPath: string,
  routes: RouteEntry[],
  config: ScanConfig = loadScanConfigFromEnv(),
): Promise<PermissionScanResult> {
  const files = await collectFrontendSourceFiles(frontendPath, config.maxFiles);
  const guards: GuardEntry[] = [];

  for (const filePath of files) {
    await scanRouteGuardsInFile(filePath, frontendPath, guards);
  }

  for (const filePath of files) {
    await scanBusinessFlowGuards(filePath, frontendPath, guards);
  }

  return {
    roles: [...DEFAULT_ROLES],
    guards: dedupeGuards(guards),
  };
}

export function applyPublicFlagsToRoutes(
  routes: RouteEntry[],
  guards: GuardEntry[],
): RouteEntry[] {
  const protectedRoutes = new Set(
    guards.filter((g) => g.guardType !== "none").map((g) => g.route),
  );
  return routes.map((route) => ({
    ...route,
    public: !protectedRoutes.has(route.path),
  }));
}

export async function buildPermissionModelDocument(
  frontendPath: string,
  routes: RouteEntry[],
  config?: ScanConfig,
): Promise<Omit<PermissionModelDocument, "version" | "generatedAt">> {
  const scan = await extractPermissionModel(frontendPath, routes, config);
  const routesWithPublic = applyPublicFlagsToRoutes(routes, scan.guards);
  const publicRouteCount = routesWithPublic.filter((r) => r.public !== false).length;

  return {
    roles: scan.roles,
    guards: scan.guards,
    summary: buildSummary(scan.guards, publicRouteCount),
  };
}
