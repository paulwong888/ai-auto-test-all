import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { parse } from "@babel/parser";
import babelTraverse from "@babel/traverse";
import * as t from "@babel/types";
import type { RawComponent, InteractiveElement } from "../artifacts/types.js";
import type { ScanConfig } from "../config.js";

const SKIP_PATTERNS = [
  "**/node_modules/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/*.d.ts",
  "**/stories/**",
  "**/*.stories.*",
];

const INTERACTIVE_TAGS = new Set([
  "button",
  "input",
  "a",
  "select",
  "textarea",
  "form",
]);

type TraverseFn = (ast: t.File, opts: Record<string, (path: any) => void>) => void;

const traverse = (
  (babelTraverse as unknown as { default?: TraverseFn }).default ??
  (babelTraverse as unknown as TraverseFn)
);

export interface ScanResult {
  components: RawComponent[];
  filesScanned: number;
  parseErrors: number;
}

export async function scanReactProject(
  frontendPath: string,
  config: ScanConfig,
): Promise<ScanResult> {
  const srcRoots = ["src/pages", "src/components", "src"];
  const files: string[] = [];

  for (const root of srcRoots) {
    const pattern = path.join(frontendPath, root, "**/*.{tsx,jsx}");
    const found = await glob(pattern, {
      ignore: SKIP_PATTERNS.map((p) => path.join(frontendPath, p)),
      nodir: true,
      absolute: true,
    });
    for (const f of found) {
      if (!files.includes(f)) files.push(f);
    }
    if (files.length >= config.maxFiles) break;
  }

  const limited = files.slice(0, config.maxFiles);
  const components: RawComponent[] = [];
  let parseErrors = 0;

  for (const filePath of limited) {
    if (components.length >= config.maxComponents) break;
    try {
      const source = await readFile(filePath, "utf8");
      const parsed = parseFile(source, filePath, frontendPath);
      if (parsed) components.push(parsed);
    } catch {
      parseErrors += 1;
    }
  }

  return {
    components,
    filesScanned: limited.length,
    parseErrors,
  };
}

function typeAnnotationToString(node: t.TSType | t.TSTypeAnnotation | null | undefined): string | undefined {
  if (!node) return undefined;
  const typeNode = t.isTSTypeAnnotation(node) ? node.typeAnnotation : node;
  if (t.isTSStringKeyword(typeNode)) return "string";
  if (t.isTSBooleanKeyword(typeNode)) return "boolean";
  if (t.isTSNumberKeyword(typeNode)) return "number";
  if (t.isTSAnyKeyword(typeNode)) return "any";
  if (t.isTSVoidKeyword(typeNode)) return "void";
  if (t.isTSTypeReference(typeNode) && t.isIdentifier(typeNode.typeName)) {
    return typeNode.typeName.name;
  }
  if (t.isTSUnionType(typeNode)) {
    return typeNode.types
      .map((part) => typeAnnotationToString(part))
      .filter(Boolean)
      .join(" | ");
  }
  return undefined;
}

function extractPropsFromInterface(body: t.TSInterfaceBody): RawComponent["props"] {
  const props: NonNullable<RawComponent["props"]> = [];
  for (const member of body.body) {
    if (!t.isTSPropertySignature(member) || !t.isIdentifier(member.key)) continue;
    props.push({
      name: member.key.name,
      type: typeAnnotationToString(member.typeAnnotation),
      required: !member.optional,
    });
  }
  return props.length ? props : undefined;
}

function extractPropsFromTypeLiteral(typeLiteral: t.TSTypeLiteral): RawComponent["props"] {
  const props: NonNullable<RawComponent["props"]> = [];
  for (const member of typeLiteral.members) {
    if (!t.isTSPropertySignature(member) || !t.isIdentifier(member.key)) continue;
    props.push({
      name: member.key.name,
      type: typeAnnotationToString(member.typeAnnotation),
      required: !member.optional,
    });
  }
  return props.length ? props : undefined;
}

function parseFile(
  source: string,
  filePath: string,
  frontendPath: string,
): RawComponent | null {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    errorRecovery: true,
  });

  let componentName: string | null = null;
  const state: Array<{ name: string; initial?: string }> = [];
  const propsCollected: NonNullable<RawComponent["props"]> = [];
  const interactiveElements: InteractiveElement[] = [];
  const conditionalRendering: Array<{ condition: string; type?: string }> = [];
  const featureFlags = new Set<string>();
  let hasCreateContext = false;
  let jsxElementCount = 0;

  traverse(ast, {
    TSInterfaceDeclaration(pathNode: any) {
      const id = pathNode.node.id?.name ?? "";
      if (!/Props$/.test(id) && id !== "Props") return;
      const extracted = extractPropsFromInterface(pathNode.node.body);
      if (extracted) propsCollected.push(...extracted);
    },
    TSTypeAliasDeclaration(pathNode: any) {
      const id = pathNode.node.id?.name ?? "";
      if (!/Props$/.test(id) && id !== "Props") return;
      const ann = pathNode.node.typeAnnotation;
      if (t.isTSTypeLiteral(ann)) {
        const extracted = extractPropsFromTypeLiteral(ann);
        if (extracted) propsCollected.push(...extracted);
      }
    },
    ExportDefaultDeclaration(pathNode: any) {
      const decl = pathNode.node.declaration;
      if (t.isIdentifier(decl) && isPascalCase(decl.name)) {
        componentName = decl.name;
      } else if (t.isFunctionDeclaration(decl) && decl.id && isPascalCase(decl.id.name)) {
        componentName = decl.id.name;
      }
    },
    FunctionDeclaration(pathNode: any) {
      const id = pathNode.node.id?.name;
      if (id && isPascalCase(id) && !componentName) componentName = id;
    },
    VariableDeclarator(pathNode: any) {
      if (!t.isIdentifier(pathNode.node.id)) return;
      const name = pathNode.node.id.name;
      if (!isPascalCase(name)) return;
      if (
        t.isArrowFunctionExpression(pathNode.node.init) ||
        t.isFunctionExpression(pathNode.node.init)
      ) {
        if (!componentName) componentName = name;
      }
    },
    CallExpression(pathNode: any) {
      const callee = pathNode.node.callee;
      if (t.isIdentifier(callee)) {
        const name = callee.name;
        if (name === "useState" && pathNode.node.arguments[0]) {
          const arg = pathNode.node.arguments[0];
          const parent = pathNode.parentPath;
          if (!parent?.isVariableDeclarator?.()) return;

          let stateName: string | undefined;
          const id = parent.node.id;
          if (t.isIdentifier(id)) {
            stateName = id.name;
          } else if (
            t.isArrayPattern(id) &&
            id.elements[0] &&
            t.isIdentifier(id.elements[0])
          ) {
            stateName = id.elements[0].name;
          }

          if (stateName) {
            state.push({
              name: stateName,
              initial: t.isStringLiteral(arg)
                ? arg.value
                : t.isNumericLiteral(arg)
                  ? String(arg.value)
                  : undefined,
            });
          }
        }
        if (name === "useFeatureFlag" && pathNode.node.arguments[0]) {
          const flagArg = pathNode.node.arguments[0];
          if (t.isStringLiteral(flagArg)) featureFlags.add(flagArg.value);
        }
        if (name === "createContext") {
          hasCreateContext = true;
        }
      }
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
        const prop = callee.property.name;
        if (prop === "useFeatureFlag" && pathNode.node.arguments[0]) {
          const flagArg = pathNode.node.arguments[0];
          if (t.isStringLiteral(flagArg)) featureFlags.add(flagArg.value);
        }
      }
    },
    MemberExpression(pathNode: any) {
      const node = pathNode.node;
      if (t.isIdentifier(node.property)) {
        const prop = node.property.name;
        if (
          prop.startsWith("ENABLE_") ||
          /feature/i.test(prop) ||
          /flag/i.test(prop)
        ) {
          if (t.isIdentifier(node.object) && /feature|flag/i.test(node.object.name)) {
            featureFlags.add(`${node.object.name}.${prop}`);
          }
        }
      }
      if (
        t.isMemberExpression(node.object) &&
        t.isIdentifier(node.object.object) &&
        node.object.object.name === "process" &&
        t.isIdentifier(node.object.property) &&
        node.object.property.name === "env" &&
        t.isIdentifier(node.property) &&
        node.property.name.startsWith("ENABLE_")
      ) {
        featureFlags.add(`process.env.${node.property.name}`);
      }
    },
    JSXOpeningElement(pathNode: any) {
      jsxElementCount += 1;
      const tag = jsxTagName(pathNode.node.name);
      if (!tag || !INTERACTIVE_TAGS.has(tag.toLowerCase())) return;

      const attrs: Record<string, string> = {};
      let handler = "";
      let testId = "";
      let ariaLabel = "";

      for (const attr of pathNode.node.attributes) {
        if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
        const key = attr.name.name;
        const val = jsxAttrValue(attr.value);
        attrs[key] = val;
        if (key.startsWith("on")) handler = key;
        if (key === "data-testid") testId = val;
        if (key === "aria-label") ariaLabel = val;
      }

      const role = inferRole(tag, attrs);
      interactiveElements.push({
        elementType: tag.toLowerCase(),
        role,
        handler: handler || undefined,
        attributes: attrs,
        line: pathNode.node.loc?.start.line,
        existingTestId: testId || undefined,
        ariaLabel: ariaLabel || undefined,
        binding: attrs.name || attrs.id || undefined,
      });
    },
    ConditionalExpression(pathNode: any) {
      const test = pathNode.node.test;
      if (test?.start != null && test?.end != null) {
        conditionalRendering.push({
          condition: source.slice(test.start, test.end),
          type: "ternary",
        });
      }
    },
    LogicalExpression(pathNode: any) {
      if (pathNode.node.operator === "&&") {
        const left = pathNode.node.left;
        if (left?.start != null && left?.end != null) {
          conditionalRendering.push({
            condition: source.slice(left.start, left.end),
            type: "and-short-circuit",
          });
        }
      }
    },
  });

  if (!componentName) {
    componentName = path.basename(filePath, path.extname(filePath));
    if (!isPascalCase(componentName)) return null;
  }

  const relPath = path.relative(frontendPath, filePath);
  const props = dedupeProps(propsCollected);
  const isProvider =
    hasCreateContext && interactiveElements.length === 0 && jsxElementCount <= 2;

  return {
    name: componentName,
    type: "react",
    filePath: relPath,
    props,
    state: state.length ? state : undefined,
    interactiveElements,
    conditionalRendering: conditionalRendering.length
      ? conditionalRendering
      : undefined,
    featureFlags: featureFlags.size ? [...featureFlags] : [],
    pageKind: isProvider ? "provider" : undefined,
    excludeFromPom: isProvider ? true : undefined,
  };
}

function dedupeProps(
  props: NonNullable<RawComponent["props"]>,
): RawComponent["props"] {
  const seen = new Map<string, NonNullable<RawComponent["props"]>[number]>();
  for (const prop of props) {
    seen.set(prop.name, prop);
  }
  const values = [...seen.values()];
  return values.length ? values : undefined;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function jsxTagName(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string | null {
  if (t.isJSXIdentifier(name)) return name.name;
  return null;
}

function jsxAttrValue(value: t.JSXAttribute["value"]): string {
  if (!value) return "true";
  if (t.isStringLiteral(value)) return value.value;
  if (t.isJSXExpressionContainer(value)) {
    if (t.isStringLiteral(value.expression)) return value.expression.value;
    if (t.isBooleanLiteral(value.expression)) return String(value.expression.value);
  }
  return "{expr}";
}

function inferRole(tag: string, attrs: Record<string, string>): string {
  const type = attrs.type;
  if (tag === "input" && type) return `${type}-input`;
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return "select";
  if (tag === "textarea") return "textarea";
  return tag.toLowerCase();
}
