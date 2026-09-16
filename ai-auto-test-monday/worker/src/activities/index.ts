import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Context } from "@temporalio/activity";
import type { PipelineInput } from "@monday/agent-core/workflow";
import {
  runScriptAnalyst,
  runStageManager,
  applyStageManagerPatches,
  runBlockingCoach,
  runSetDesigner,
  runChoreographer,
  runAssistantDirector,
  runContinuityLead,
  resolveAvailablePomsFromDir,
  normalizePomExportClass,
  pomFileNameToClassName,
  type ComponentRegistry,
  type TestIdInjections,
  type LocatorCatalog,
  type JourneysDocument,
} from "@monday/agent-core";
import { publishProgress } from "../lib/redis.js";
import {
  clearRunCurrentAgent,
  insertArtifactIndex,
  updateExecutionStatus,
} from "../lib/db.js";

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function throwIfCancelled(): void {
  if (Context.current().cancellationSignal.aborted) {
    throw new Error("Activity cancelled");
  }
}

async function notify(
  input: PipelineInput,
  agent: string,
  status: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await publishProgress(input.runId, {
    agent,
    status,
    artifactRoot: input.artifactRoot,
    ...extra,
  });
}

async function readRegistry(root: string): Promise<ComponentRegistry> {
  const raw = await readFile(path.join(root, "component-registry.json"), "utf8");
  return JSON.parse(raw) as ComponentRegistry;
}

async function readInjections(root: string): Promise<TestIdInjections> {
  const raw = await readFile(path.join(root, "testid-injections.json"), "utf8");
  return JSON.parse(raw) as TestIdInjections;
}

export async function scriptAnalyst(input: PipelineInput): Promise<void> {
  throwIfCancelled();
  await notify(input, "scriptAnalyst", "started");

  const registry = await runScriptAnalyst({
    projectId: input.projectId,
    runId: input.runId,
    frontendPath: input.frontendPath,
  });

  const out = path.join(input.artifactRoot, "component-registry.json");
  await writeJson(out, registry);
  await insertArtifactIndex(input.runId, "scriptAnalyst", "registry", out, {
    componentCount: registry.components.length,
  });

  throwIfCancelled();
  await notify(input, "scriptAnalyst", "completed");
}

export async function stageManager(input: PipelineInput): Promise<void> {
  throwIfCancelled();
  await notify(input, "stageManager", "started");

  const registry = await readRegistry(input.artifactRoot);
  const apply = input.applyTestIds === true;
  const injections = runStageManager(registry, {
    dryRun: !apply,
    repoRoot: input.frontendPath,
    runId: input.runId,
  });

  const out = path.join(input.artifactRoot, "testid-injections.json");
  await writeJson(out, injections);
  await insertArtifactIndex(input.runId, "stageManager", "injections", out, {
    patchCount: injections.patches.length,
    dryRun: injections.dryRun,
  });

  if (apply) {
    const report = await applyStageManagerPatches(
      injections,
      input.frontendPath,
      input.runId,
    );
    const reportPath = path.join(input.artifactRoot, "apply-report.json");
    await writeJson(reportPath, report);
    await insertArtifactIndex(input.runId, "stageManager", "apply-report", reportPath, {
      applied: report.applied,
      failed: report.failed,
    });
  }

  throwIfCancelled();
  await notify(input, "stageManager", "completed");
}

export async function blockingCoach(input: PipelineInput): Promise<void> {
  throwIfCancelled();
  await notify(input, "blockingCoach", "started");

  const registry = await readRegistry(input.artifactRoot);
  const injections = await readInjections(input.artifactRoot);
  const catalog = runBlockingCoach(registry, injections);

  const out = path.join(input.artifactRoot, "locator-catalog.json");
  await writeJson(out, catalog);
  await insertArtifactIndex(input.runId, "blockingCoach", "locators", out, {
    locatorCount: catalog.locators.length,
  });

  throwIfCancelled();
  await notify(input, "blockingCoach", "completed");
}

export async function setDesigner(input: PipelineInput): Promise<void> {
  throwIfCancelled();
  await notify(input, "setDesigner", "started");

  const registry = await readRegistry(input.artifactRoot);
  const catalogRaw = await readFile(
    path.join(input.artifactRoot, "locator-catalog.json"),
    "utf8",
  );
  const catalog = JSON.parse(catalogRaw) as LocatorCatalog;

  let pomFiles = await runSetDesigner(registry, catalog);
  const pomDir = path.join(input.artifactRoot, "poms");
  await ensureDir(pomDir);

  for (const pom of pomFiles) {
    const safeName = path.basename(pom.fileName);
    const filePath = path.join(pomDir, safeName);
    const className = pomFileNameToClassName(safeName);
    const content = normalizePomExportClass(pom.content, className);
    await writeFile(filePath, content, "utf8");
    await insertArtifactIndex(
      input.runId,
      "setDesigner",
      "pom",
      filePath,
    );
  }

  throwIfCancelled();
  await notify(input, "setDesigner", "completed");
}

export async function choreographer(input: PipelineInput): Promise<void> {
  throwIfCancelled();
  await notify(input, "choreographer", "started");

  const registry = await readRegistry(input.artifactRoot);
  const pomDir = path.join(input.artifactRoot, "poms");
  const availablePoms = await resolveAvailablePomsFromDir(pomDir);
  console.info(
    `[choreographer] start runId=${input.runId} availablePoms=${availablePoms.join(", ")}`,
  );

  try {
    const doc = await runChoreographer({
      registry,
      targetUrl: input.targetUrl,
      availablePoms,
    });

    console.info(
      `[choreographer] done runId=${input.runId} journeyCount=${doc.journeys.length}`,
    );

    const out = path.join(input.artifactRoot, "journeys.json");
    await writeJson(out, doc);
    await insertArtifactIndex(input.runId, "choreographer", "journeys", out, {
      journeyCount: doc.journeys.length,
    });

    throwIfCancelled();
    await notify(input, "choreographer", "completed");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await publishProgress(input.runId, {
      agent: "choreographer",
      status: "failed",
      artifactRoot: input.artifactRoot,
      error,
    });
    throw err;
  }
}

export async function assistantDirector(input: PipelineInput): Promise<void> {
  throwIfCancelled();
  await notify(input, "assistantDirector", "started");

  const journeysRaw = await readFile(
    path.join(input.artifactRoot, "journeys.json"),
    "utf8",
  );
  const journeysDoc = JSON.parse(journeysRaw) as JourneysDocument;

  const catalogRaw = await readFile(
    path.join(input.artifactRoot, "locator-catalog.json"),
    "utf8",
  );
  const catalog = JSON.parse(catalogRaw) as LocatorCatalog;

  const pomsDir = path.join(input.artifactRoot, "poms");
  const testsDir = path.join(input.artifactRoot, "tests");
  await ensureDir(testsDir);

  const specs = await runAssistantDirector({
    journeysDoc,
    catalog,
    pomsDir,
    targetUrl: input.targetUrl,
  });

  const keepSpecFiles = new Set(specs.map((spec) => spec.fileName));
  try {
    const existing = await readdir(testsDir);
    for (const file of existing.filter((f) => f.endsWith(".spec.ts"))) {
      if (!keepSpecFiles.has(file)) {
        await unlink(path.join(testsDir, file));
      }
    }
  } catch {
    // tests dir may not exist yet
  }

  for (const spec of specs) {
    const filePath = path.join(testsDir, spec.fileName);
    await writeFile(filePath, spec.content, "utf8");
    await insertArtifactIndex(
      input.runId,
      "assistantDirector",
      "spec",
      filePath,
      { journeyId: spec.journeyId },
    );
  }

  throwIfCancelled();
  await notify(input, "assistantDirector", "completed");
}

export interface ContinuityLeadResult {
  failed: number;
  passed: number;
  total: number;
}

export async function continuityLead(
  input: PipelineInput,
): Promise<ContinuityLeadResult> {
  throwIfCancelled();
  await updateExecutionStatus(
    input.runId,
    "running",
    input.executionMode,
  );
  await notify(input, "continuityLead", "started");

  console.info(
    `[continuityLead] start runId=${input.runId} mode=${input.executionMode ?? "auto"}${input.journeyIds?.length ? ` journeyIds=${input.journeyIds.join(",")}` : ""}`,
  );

  const report = await runContinuityLead({
    projectId: input.projectId,
    runId: input.runId,
    artifactRoot: input.artifactRoot,
    frontendPath: input.frontendPath,
    targetUrl: input.targetUrl,
    executionMode: input.executionMode,
    platformBaseUrl: process.env.PLATFORM_BASE_URL,
    projectName: input.projectId,
    journeyIds: input.journeyIds,
  });

  const out = path.join(input.artifactRoot, "execution-report.json");
  await writeJson(out, report);
  await insertArtifactIndex(input.runId, "continuityLead", "execution-report", out, {
    passed: report.summary.passed,
    failed: report.summary.failed,
  });

  throwIfCancelled();
  await updateExecutionStatus(
    input.runId,
    report.summary.failed === 0 ? "completed" : "failed",
    input.executionMode,
  );
  // Keep overlay_workflow_id: the overlay workflow remains the authoritative
  // progress source for this run after completion (queryable while Temporal
  // retention lasts); clearing it would regress the run view to the stale
  // original workflow state.
  await clearRunCurrentAgent(input.runId);
  await notify(input, "continuityLead", "completed");
  await publishProgress(input.runId, {
    agent: "continuityLead",
    status:
      report.summary.failed === 0 ? "execution-completed" : "execution-failed",
    artifactRoot: input.artifactRoot,
    error:
      report.summary.failed > 0
        ? `${report.summary.failed} journey(s) failed`
        : undefined,
  });

  console.info(
    `[continuityLead] done runId=${input.runId} mode=${report.executionMode} passed=${report.summary.passed} failed=${report.summary.failed} flaky=${report.summary.flaky ?? 0} skipped=${report.summary.skipped}`,
  );

  return {
    failed: report.summary.failed,
    passed: report.summary.passed,
    total: report.summary.total,
  };
}
