import type { ComponentEntry } from "../artifacts/types.js";
import type { z } from "zod";
import { scriptAnalystReconcileComponentSchema } from "../artifacts/types.js";

type ReconcileComponent = z.input<typeof scriptAnalystReconcileComponentSchema>;

function normalizeChildComponents(
  childComponents: ReconcileComponent["childComponents"],
): string[] | undefined {
  if (childComponents == null) return undefined;
  return childComponents.map((item) => {
    if (typeof item === "string") return item;
    const name = item.name;
    if (typeof name === "string") return name;
    return String(name ?? item);
  });
}

function componentKey(comp: Pick<ComponentEntry, "name" | "filePath">): string {
  return `${comp.filePath}::${comp.name}`;
}

function astElementSignature(comp: ComponentEntry): string {
  return comp.interactiveElements
    .map(
      (el) =>
        `${el.role}|${el.elementType}|${el.line ?? ""}|${el.existingTestId ?? ""}`,
    )
    .join(";");
}

function reconcileHandlerPatchesValid(
  ast: ComponentEntry,
  llm: ReconcileComponent,
): boolean {
  const patches = llm.handlerPatches;
  if (!patches?.length) return true;
  const astRoles = new Set(ast.interactiveElements.map((el) => el.role));
  return patches.every((patch) => astRoles.has(patch.role));
}

/**
 * Merge LLM reconcile output into AST registry entries.
 * AST facts (elements, lines, testids) are immutable; LLM may only enrich semantics.
 */
export function mergeAstWithLlm(
  astComponents: ComponentEntry[],
  llmComponents: ReconcileComponent[],
): ComponentEntry[] {
  const llmByKey = new Map(
    llmComponents.map((c) => [componentKey(c), c]),
  );

  return astComponents.map((ast) => {
    const llm = llmByKey.get(componentKey(ast));
    if (!llm) return ast;
    if (!reconcileHandlerPatchesValid(ast, llm)) {
      console.warn(
        `[scriptAnalyst] merge rejected for ${ast.name}: handlerPatches reference unknown roles`,
      );
      return ast;
    }

    const merged: ComponentEntry = { ...ast };

    if (llm.businessSemantics) {
      merged.businessSemantics = llm.businessSemantics;
    }
    const childComponents = normalizeChildComponents(llm.childComponents);
    if (childComponents?.length) {
      merged.childComponents = [...new Set(childComponents)];
    }
    if (llm.featureFlags?.length) {
      merged.featureFlags = [
        ...new Set([...(ast.featureFlags ?? []), ...llm.featureFlags]),
      ];
    }
    if (llm.pageKind && !ast.pageKind) {
      merged.pageKind = llm.pageKind;
    }

    if (llm.props?.length) {
      const propMap = new Map((ast.props ?? []).map((p) => [p.name, { ...p }]));
      for (const prop of llm.props) {
        const existing = propMap.get(prop.name);
        if (existing) {
          propMap.set(prop.name, {
            ...existing,
            description: prop.description ?? existing.description ?? undefined,
            type: existing.type ?? prop.type ?? undefined,
            required: existing.required ?? prop.required ?? undefined,
          });
        } else if (prop.name) {
          propMap.set(prop.name, {
            name: prop.name,
            ...(prop.type != null ? { type: prop.type } : {}),
            ...(prop.required != null ? { required: prop.required } : {}),
            ...(prop.description != null ? { description: prop.description } : {}),
          });
        }
      }
      merged.props = [...propMap.values()];
    }

    if (llm.conditionalSemanticPatches?.length && ast.conditionalRendering?.length) {
      merged.conditionalRendering = ast.conditionalRendering.map((cond) => {
        const match = llm.conditionalSemanticPatches?.find(
          (c) => c.condition === cond.condition,
        );
        if (!match?.semanticType) return cond;
        return {
          ...cond,
          semanticType: match.semanticType ?? cond.semanticType,
        };
      });
    }

    if (llm.handlerPatches?.length) {
      merged.interactiveElements = ast.interactiveElements.map((el) => {
        const patch = llm.handlerPatches?.find((p) => p.role === el.role);
        if (!patch?.handler) return el;
        return { ...el, handler: patch.handler };
      });
    }

    return merged;
  });
}

export function validateMergePreservesAstFacts(
  before: ComponentEntry[],
  after: ComponentEntry[],
): boolean {
  const beforeMap = new Map(before.map((c) => [componentKey(c), c]));
  for (const comp of after) {
    const ast = beforeMap.get(componentKey(comp));
    if (!ast) continue;
    if (astElementSignature(ast) !== astElementSignature(comp)) return false;
    if (ast.filePath !== comp.filePath) return false;
  }
  return true;
}
