import type { ComponentEntry } from "../artifacts/types.js";
import type { ScriptAnalystConfig } from "../config.js";

export type ReconcileBatchEntry = { ast: ComponentEntry; source: string };

export function componentReconcileWeight(ast: ComponentEntry): number {
  const cond = ast.conditionalRendering?.length ?? 0;
  const inter = ast.interactiveElements.length;
  return 1 + Math.floor(cond / 10) + Math.floor(inter / 5);
}

export function mustSoloReconcileBatch(
  ast: ComponentEntry,
  soloConditionalThreshold: number,
): boolean {
  return (ast.conditionalRendering?.length ?? 0) >= soloConditionalThreshold;
}

export function buildReconcilePayloadEntry(
  ast: ComponentEntry,
  source: string,
): {
  astSkeleton: Record<string, unknown>;
  source: string;
} {
  return {
    astSkeleton: {
      name: ast.name,
      filePath: ast.filePath,
      pageKind: ast.pageKind,
      excludeFromPom: ast.excludeFromPom,
      props: ast.props?.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
      })),
      state: ast.state,
      interactiveElements: ast.interactiveElements.map((el) => ({
        role: el.role,
        elementType: el.elementType,
        line: el.line,
      })),
      conditionalRendering: ast.conditionalRendering?.map((c) => ({
        condition: c.condition,
      })),
      featureFlags: ast.featureFlags,
      childComponents: ast.childComponents,
      businessSemantics: ast.businessSemantics,
    },
    source,
  };
}

export function buildReconcileBatches(
  components: ComponentEntry[],
  sources: Map<string, string>,
  config: Pick<
    ScriptAnalystConfig,
    "batchFiles" | "maxChars" | "batchWeightLimit" | "soloConditionalThreshold"
  >,
): ReconcileBatchEntry[][] {
  const batches: ReconcileBatchEntry[][] = [];
  let current: ReconcileBatchEntry[] = [];
  let currentChars = 0;
  let currentWeight = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentChars = 0;
    currentWeight = 0;
  };

  for (const ast of components) {
    const source = sources.get(ast.filePath) ?? "";
    const entry = { ast, source };
    const entryChars = source.length + JSON.stringify(ast).length;
    const weight = componentReconcileWeight(ast);

    if (mustSoloReconcileBatch(ast, config.soloConditionalThreshold)) {
      flush();
      batches.push([entry]);
      continue;
    }

    if (
      current.length >= config.batchFiles ||
      (current.length > 0 && currentWeight + weight > config.batchWeightLimit) ||
      (current.length > 0 && currentChars + entryChars > config.maxChars)
    ) {
      flush();
    }

    current.push(entry);
    currentChars += entryChars;
    currentWeight += weight;
  }

  flush();
  return batches;
}
