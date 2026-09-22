import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { parse } from "@babel/parser";
import babelTraverse from "@babel/traverse";
import * as t from "@babel/types";

export const SKIP_PATTERNS = [
  "**/node_modules/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/*.d.ts",
  "**/stories/**",
  "**/*.stories.*",
];

export const SRC_ROOTS = ["src/pages", "src/components", "src"];

/** Route tables often live here; always include even when maxFiles truncates the glob walk. */
export const ROUTE_ENTRY_CANDIDATES = [
  "src/App.js",
  "src/App.jsx",
  "src/App.tsx",
  "src/routes.js",
  "src/routes/index.js",
  "src/router.js",
];

/** Nested Route hosts common in legacy React Router apps (crm-front). */
export const ROUTE_NESTED_CANDIDATES = [
  "src/CreditControl/CreditControlApprove.js",
  "src/components/Approval/Approval.js",
  "src/Case/WaivingApproval/WaivingPage.jsx",
  "src/BlackListManagement/view/BlackListMain.js",
  "src/ui_components/UI.js",
];

type TraverseFn = (ast: t.File, opts: Record<string, (path: unknown) => void>) => void;

export const traverse = (
  (babelTraverse as unknown as { default?: TraverseFn }).default ??
  (babelTraverse as unknown as TraverseFn)
);

export function parseSourceFile(source: string): t.File {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    errorRecovery: true,
  });
}

export async function collectFrontendSourceFiles(
  frontendPath: string,
  maxFiles: number,
): Promise<string[]> {
  const files: string[] = [];

  for (const rel of ROUTE_ENTRY_CANDIDATES) {
    const abs = path.join(frontendPath, rel);
    if (existsSync(abs) && !files.includes(abs)) {
      files.push(abs);
    }
  }

  for (const root of SRC_ROOTS) {
    const patterns = [
      path.join(frontendPath, root, "**/*.{tsx,jsx,js}"),
      path.join(frontendPath, root, "*.{tsx,jsx,js}"),
    ];
    for (const pattern of patterns) {
      const found = await glob(pattern, {
        ignore: SKIP_PATTERNS.map((p) => path.join(frontendPath, p)),
        nodir: true,
        absolute: true,
      });
      for (const file of found) {
        if (!files.includes(file)) files.push(file);
      }
      if (files.length >= maxFiles) break;
    }
    if (files.length >= maxFiles) break;
  }

  return files.slice(0, maxFiles);
}

export async function collectRouteSourceFiles(
  frontendPath: string,
  maxFiles: number,
): Promise<string[]> {
  const files: string[] = [];

  for (const rel of [...ROUTE_ENTRY_CANDIDATES, ...ROUTE_NESTED_CANDIDATES]) {
    const abs = path.join(frontendPath, rel);
    if (existsSync(abs) && !files.includes(abs)) {
      files.push(abs);
    }
  }

  const ignore = SKIP_PATTERNS.map((p) => path.join(frontendPath, p));
  const patterns = [
    path.join(frontendPath, "src", "**/*.{tsx,jsx,js}"),
    path.join(frontendPath, "src", "*.{tsx,jsx,js}"),
  ];

  for (const pattern of patterns) {
    const found = await glob(pattern, { ignore, nodir: true, absolute: true });
    for (const file of found) {
      if (files.includes(file)) continue;
      if (files.length >= maxFiles) break;
      try {
        const source = await readFile(file, "utf8");
        if (
          source.includes("<Route") ||
          source.includes("<Link") ||
          source.includes("linkTo") ||
          /href=["']\//.test(source)
        ) {
          files.push(file);
        }
      } catch {
        // skip unreadable files
      }
    }
    if (files.length >= maxFiles) break;
  }

  return files.slice(0, maxFiles);
}

export async function readAndParseFile(
  filePath: string,
): Promise<{ ast: t.File; source: string } | null> {
  try {
    const source = await readFile(filePath, "utf8");
    return { ast: parseSourceFile(source), source };
  } catch {
    return null;
  }
}

export function jsxTagName(
  name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName,
): string | null {
  if (t.isJSXIdentifier(name)) return name.name;
  return null;
}

export function jsxAttrStringValue(value: t.JSXAttribute["value"]): string | null {
  if (!value) return null;
  if (t.isStringLiteral(value)) return value.value;
  if (t.isJSXExpressionContainer(value)) {
    if (t.isStringLiteral(value.expression)) return value.expression.value;
  }
  return null;
}

export function extractJsxElementComponentName(
  node: t.JSXElement | t.JSXFragment | null | undefined,
): string | null {
  if (!node || !t.isJSXElement(node)) return null;
  const tag = jsxTagName(node.openingElement.name);
  return tag && /^[A-Z]/.test(tag) ? tag : null;
}

export function extractRouteElementName(
  value: t.JSXAttribute["value"] | null | undefined,
): string | null {
  if (!value || !t.isJSXExpressionContainer(value)) return null;
  const expr = value.expression;
  if (t.isJSXElement(expr)) {
    return extractJsxElementComponentName(expr);
  }
  if (t.isIdentifier(expr)) {
    return expr.name;
  }
  return null;
}

export function inferComponentNameFromFile(
  source: string,
  filePath: string,
): string {
  let componentName = path.basename(filePath, path.extname(filePath));
  try {
    const ast = parseSourceFile(source);
    traverse(ast, {
      ExportDefaultDeclaration(pathNode: any) {
        const decl = pathNode.node.declaration;
        if (t.isIdentifier(decl) && /^[A-Z]/.test(decl.name)) {
          componentName = decl.name;
        } else if (
          t.isFunctionDeclaration(decl) &&
          decl.id &&
          /^[A-Z]/.test(decl.id.name)
        ) {
          componentName = decl.id.name;
        }
      },
      FunctionDeclaration(pathNode: any) {
        const id = pathNode.node.id?.name;
        if (id && /^[A-Z]/.test(id)) componentName = id;
      },
    });
  } catch {
    // fall back to filename
  }
  return componentName;
}

export function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}
