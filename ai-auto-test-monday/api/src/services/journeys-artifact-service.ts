import type { ComponentRegistry, JourneysDocument } from "@monday/agent-core";
import {
  buildPomMethodMap,
  findJourneyValidationErrors,
  parseAndNormalizeJourneysDocument,
  pomFileNameToClassName,
} from "@monday/agent-core";
import { pool } from "../db/pool.js";
import { apiArtifactStore, runArtifactPrefix } from "../lib/artifact-store.js";
import { getPipelineRun, isRunActivelyRunning } from "./pipeline-service.js";

export async function getPomCatalog(runId: string): Promise<{
  poms: string[];
  methods: Record<string, string[]>;
}> {
  const { run } = await getPipelineRun(runId);
  const prefix = runArtifactPrefix(run);
  const store = apiArtifactStore();
  const keys = await store.listRelativeKeys(prefix);
  const pomKeys = keys.filter((k) => k.startsWith("poms/") && k.endsWith(".ts"));
  const poms = pomKeys.map((k) =>
    pomFileNameToClassName(k.replace(/^poms\//, "")),
  );
  const entries = await Promise.all(
    pomKeys.map(async (key) => {
      const content = (await store.getText(prefix, key)) ?? "";
      const base = key.replace(/^poms\//, "");
      return { className: pomFileNameToClassName(base), content };
    }),
  );
  return { poms, methods: buildPomMethodMap(entries) };
}

async function loadRegistry(
  prefix: string,
): Promise<ComponentRegistry | null> {
  const raw = await apiArtifactStore().getText(prefix, "component-registry.json");
  if (!raw) return null;
  return JSON.parse(raw) as ComponentRegistry;
}

export async function putJourneysArtifact(
  runId: string,
  body: unknown,
): Promise<{ journeyCount: number; needsRegenerateSpecs: true }> {
  const { run } = await getPipelineRun(runId);
  if (isRunActivelyRunning(run as { status: string; execution_status?: string | null })) {
    throw new Error("Run is active; cannot edit journeys while pipeline is running");
  }

  const prefix = runArtifactPrefix(run);
  const store = apiArtifactStore();
  const catalog = await getPomCatalog(runId);
  const allowedPoms = new Set(catalog.poms);

  const registry = await loadRegistry(prefix);
  if (!registry) {
    throw new Error("component-registry.json not found for this run");
  }

  let doc: JourneysDocument;
  try {
    doc = parseAndNormalizeJourneysDocument(body, {
      registry,
      targetUrl: (run as { target_url?: string }).target_url ?? undefined,
      allowedPoms,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  const validationErrors = findJourneyValidationErrors(
    doc,
    allowedPoms,
    catalog.methods,
  );
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("; "));
  }

  await store.putText(prefix, "journeys.json", `${JSON.stringify(doc, null, 2)}\n`);
  await store.deletePrefix(prefix, "tests");

  await pool.query(
    `INSERT INTO artifacts_index (run_id, agent, artifact_type, file_path, summary_json)
     VALUES ($1, 'user', 'journeys', $2, $3)`,
    [
      runId,
      "journeys.json",
      JSON.stringify({
        journeyCount: doc.journeys.length,
        editedManually: true,
      }),
    ],
  );

  return { journeyCount: doc.journeys.length, needsRegenerateSpecs: true };
}

export async function getArtifactText(
  run: Record<string, unknown>,
  name: string,
): Promise<{ content: string; contentType: string } | null> {
  const prefix = runArtifactPrefix(run);
  const store = apiArtifactStore();

  if (name.startsWith("pom-")) {
    const key = `poms/${name.slice(4)}`;
    const content = await store.getText(prefix, key);
    if (content == null) return null;
    return { content, contentType: "text/plain" };
  }
  if (name.startsWith("spec-")) {
    const key = `tests/${name.slice(5)}`;
    const content = await store.getText(prefix, key);
    if (content == null) return null;
    return { content, contentType: "text/plain" };
  }

  const map: Record<string, string> = {
    registry: "component-registry.json",
    injections: "testid-injections.json",
    locators: "locator-catalog.json",
    journeys: "journeys.json",
    "execution-report": "execution-report.json",
    "apply-report": "apply-report.json",
  };
  const rel = map[name];
  if (!rel) return null;
  const content = await store.getText(prefix, rel);
  if (content == null) return null;
  return {
    content,
    contentType: rel.endsWith(".json") ? "application/json" : "text/plain",
  };
}
