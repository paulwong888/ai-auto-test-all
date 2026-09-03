import type { ComponentRegistry, RawComponent } from "../artifacts/types.js";
import { scriptAnalystEnhancementSchema } from "../artifacts/types.js";
import { loadLlmConfigFromEnv, loadScanConfigFromEnv } from "../config.js";
import { HigressClient } from "../llm/higress-client.js";
import { scanReactProject } from "../scanner/react-scanner.js";

export interface ScriptAnalystInput {
  projectId: string;
  runId: string;
  frontendPath: string;
}

const BATCH_SIZE = 15;

export async function runScriptAnalyst(
  input: ScriptAnalystInput,
): Promise<ComponentRegistry> {
  const scanConfig = loadScanConfigFromEnv();
  const scan = await scanReactProject(input.frontendPath, scanConfig);

  let components = scan.components.filter(
    (c) => c.interactiveElements.length > 0 || c.state?.length,
  );

  if (components.length === 0) {
    components = scan.components;
  }

  components = await enhanceWithLlm(components);

  return {
    version: "2.0",
    projectId: input.projectId,
    runId: input.runId,
    frontendPath: input.frontendPath,
    scannedAt: new Date().toISOString(),
    scanStats: {
      filesScanned: scan.filesScanned,
      componentsFound: components.length,
      parseErrors: scan.parseErrors,
    },
    components,
  };
}

async function enhanceWithLlm(
  components: RawComponent[],
): Promise<RawComponent[]> {
  const llm = new HigressClient(loadLlmConfigFromEnv());
  const enriched = [...components];

  for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
    const batch = enriched.slice(i, i + BATCH_SIZE);
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
