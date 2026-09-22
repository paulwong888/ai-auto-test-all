import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentEntry,
  ComponentRegistry,
  PermissionModelDocument,
  RawComponent,
  RouteConfigDocument,
} from "../artifacts/types.js";
import {
  componentRegistrySchema,
  permissionModelSchema,
  routeConfigSchema,
  scriptAnalystEnhancementSchema,
  scriptAnalystReconcileSchema,
} from "../artifacts/types.js";
import {
  loadScanConfigFromEnv,
  loadScriptAnalystConfigFromEnv,
  loadScriptAnalystLlmConfigFromEnv,
} from "../config.js";
import { HigressClient } from "../llm/higress-client.js";
import { scanProject } from "../scanner/index.js";
import { buildRouteConfigDocument } from "../scanner/route-scanner.js";
import {
  applyPublicFlagsToRoutes,
  buildPermissionModelDocument,
} from "../scanner/permission-scanner.js";
import {
  buildReconcileBatches,
  buildReconcilePayloadEntry,
} from "../lib/build-reconcile-batches.js";
import { mergeAstWithLlm } from "../lib/merge-ast-with-llm.js";
import {
  RECONCILE_FEW_SHOT_ASSISTANT,
  RECONCILE_FEW_SHOT_USER,
  RECONCILE_SYSTEM_PROMPT,
} from "../lib/reconcile-prompt.js";
import {
  countFeatureFlags,
  countReadOnlyPages,
  filterRegistryComponents,
} from "../lib/script-analyst-filter.js";

export interface ScriptAnalystInput {
  projectId: string;
  runId: string;
  frontendPath: string;
}

export interface ScriptAnalystResult {
  registry: ComponentRegistry;
  routeConfig: RouteConfigDocument;
  permissionModel: PermissionModelDocument;
  llmReconciledBatches: number;
  readOnlyPages: number;
  featureFlagCount: number;
}

const ENRICH_BATCH_SIZE = 15;

const RECONCILE_FEW_SHOT = [
  { role: "user" as const, content: RECONCILE_FEW_SHOT_USER },
  { role: "assistant" as const, content: RECONCILE_FEW_SHOT_ASSISTANT },
];

export async function runScriptAnalyst(
  input: ScriptAnalystInput,
): Promise<ComponentRegistry> {
  const result = await runScriptAnalystDetailed(input);
  return result.registry;
}

export async function runScriptAnalystDetailed(
  input: ScriptAnalystInput,
): Promise<ScriptAnalystResult> {
  const scanConfig = loadScanConfigFromEnv();
  const analystConfig = loadScriptAnalystConfigFromEnv();
  const scan = await scanProject(input.frontendPath, scanConfig);

  let components = filterRegistryComponents(scan.components, scanConfig);

  let llmReconciledBatches = 0;
  if (analystConfig.llmMode === "reconcile") {
    const reconciled = await reconcileWithLlm(
      components,
      input.frontendPath,
      analystConfig,
    );
    components = reconciled.components;
    llmReconciledBatches = reconciled.batches;
  } else {
    components = await enhanceWithLlm(components);
  }

  const generatedAt = new Date().toISOString();

  const routeConfigRaw = await buildRouteConfigDocument(input.frontendPath, scanConfig);
  const permissionModelRaw = await buildPermissionModelDocument(
    input.frontendPath,
    routeConfigRaw.routes,
    scanConfig,
  );
  const routesWithPublic = applyPublicFlagsToRoutes(
    routeConfigRaw.routes,
    permissionModelRaw.guards,
  );

  const registry = componentRegistrySchema.parse({
    version: "2.0",
    projectId: input.projectId,
    runId: input.runId,
    frontendPath: input.frontendPath,
    scannedAt: generatedAt,
    scanStats: {
      filesScanned: scan.filesScanned,
      componentsFound: components.length,
      parseErrors: scan.parseErrors,
    },
    components,
  });

  const routeConfig = routeConfigSchema.parse({
    version: "1.0",
    generatedAt,
    framework: routeConfigRaw.framework,
    routes: routesWithPublic,
    navLinks: routeConfigRaw.navLinks,
  });

  const permissionModel = permissionModelSchema.parse({
    version: "1.0",
    generatedAt,
    roles: permissionModelRaw.roles,
    guards: permissionModelRaw.guards,
    summary: {
      ...permissionModelRaw.summary,
      publicRouteCount: routesWithPublic.filter((r) => r.public !== false).length,
    },
  });

  return {
    registry,
    routeConfig,
    permissionModel,
    llmReconciledBatches,
    readOnlyPages: countReadOnlyPages(components),
    featureFlagCount: countFeatureFlags(components),
  };
}

async function loadSourcesForComponents(
  frontendPath: string,
  components: ComponentEntry[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const comp of components) {
    try {
      const abs = path.join(frontendPath, comp.filePath);
      map.set(comp.filePath, await readFile(abs, "utf8"));
    } catch {
      map.set(comp.filePath, "");
    }
  }
  return map;
}

async function reconcileWithLlm(
  components: ComponentEntry[],
  frontendPath: string,
  analystConfig: ReturnType<typeof loadScriptAnalystConfigFromEnv>,
): Promise<{ components: ComponentEntry[]; batches: number }> {
  if (components.length === 0) {
    return { components, batches: 0 };
  }

  const sources = await loadSourcesForComponents(frontendPath, components);
  const batches = buildReconcileBatches(components, sources, analystConfig);

  const llm = new HigressClient(loadScriptAnalystLlmConfigFromEnv(), "scriptAnalyst");
  let merged = components;
  let reconciledBatches = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]!;
    const payload = {
      task: "reconcile_registry",
      components: batch.map(({ ast, source }) =>
        buildReconcilePayloadEntry(ast, source),
      ),
    };

    console.info(
      `[scriptAnalyst] reconcile batch ${i + 1}/${batches.length} components=${batch.map((b) => b.ast.name).join(",")}`,
    );

    const result = await llm.chatJson(
      RECONCILE_SYSTEM_PROMPT,
      JSON.stringify(payload),
      scriptAnalystReconcileSchema,
      "script_analyst_reconcile",
      {
        logContext: { batch: { current: i + 1, total: batches.length } },
        fewShotMessages: RECONCILE_FEW_SHOT,
      },
    );

    if (!result?.components?.length) {
      console.warn(
        `[scriptAnalyst] reconcile batch ${i + 1}/${batches.length} failed or empty; keeping AST`,
      );
      continue;
    }

    merged = mergeAstWithLlm(merged, result.components);
    reconciledBatches += 1;
  }

  return { components: merged, batches: reconciledBatches };
}

async function enhanceWithLlm(
  components: RawComponent[],
): Promise<RawComponent[]> {
  const llm = new HigressClient(loadScriptAnalystLlmConfigFromEnv(), "scriptAnalyst");
  const enriched = [...components];

  const enrichBatchTotal = Math.ceil(enriched.length / ENRICH_BATCH_SIZE);
  for (let i = 0; i < enriched.length; i += ENRICH_BATCH_SIZE) {
    const batch = enriched.slice(i, i + ENRICH_BATCH_SIZE);
    const enrichBatchCurrent = Math.floor(i / ENRICH_BATCH_SIZE) + 1;
    const payload = batch.map((c) => ({
      name: c.name,
      filePath: c.filePath,
      interactiveElements: c.interactiveElements.map((el) => ({
        role: el.role,
        handler: el.handler,
      })),
    }));

    const result = await llm.chatJson(
      "You enrich React component registry entries with brief business semantics. Return JSON only.",
      JSON.stringify({ components: payload }),
      scriptAnalystEnhancementSchema,
      "script_analyst_enhancement",
      { batch: { current: enrichBatchCurrent, total: enrichBatchTotal } },
    );

    if (!result) continue;

    for (const item of result.components) {
      const idx = enriched.findIndex(
        (c) => c.name === item.name && c.filePath === item.filePath,
      );
      if (idx < 0) continue;
      if (item.businessSemantics) {
        enriched[idx] = {
          ...enriched[idx],
          businessSemantics: item.businessSemantics,
        };
      }
      if (item.interactiveElements) {
        const elements = [...enriched[idx].interactiveElements];
        for (const el of item.interactiveElements) {
          const eIdx = elements.findIndex((e) => e.role === el.role);
          if (eIdx >= 0 && el.handler) {
            elements[eIdx] = { ...elements[eIdx], handler: el.handler };
          }
        }
        enriched[idx] = { ...enriched[idx], interactiveElements: elements };
      }
    }
  }

  return enriched;
}
