import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Context } from "@temporalio/activity";
import type { PipelineInput } from "@monday/agent-core/workflow";
import { toRelativeArtifactKey } from "@monday/agent-core";
import {
  runScriptAnalyst,
  runStageManager,
  applyStageManagerPatches,
  runBlockingCoach,
  runSetDesigner,
  runChoreographer,
  runAssistantDirector,
  runContinuityLead,
  buildExecutionReport,
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
  withArtifactStaging,
  runArtifactPrefix,
  type StagingContext,
} from "../lib/artifact-staging.js";
import {
  clearRunCurrentAgent,
  finalizeRunStatus,
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

function relKey(input: PipelineInput, filePath: string): string {
  return toRelativeArtifactKey(filePath, runArtifactPrefix(input));
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

async function runGenerationAgent(
  input: PipelineInput,
  agent: string,
  impl: () => Promise<void>,
  staging?: StagingContext,
): Promise<void> {
  console.info(`[${agent}] start runId=${input.runId}`);
  await notify(input, agent, "started");
  try {
    await impl();
    if (staging) await staging.flush();
    console.info(`[${agent}] end runId=${input.runId} status=ok`);
    await notify(input, agent, "completed");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (error.includes("cancelled")) {
      console.info(`[${agent}] end runId=${input.runId} status=cancelled`);
      throw err;
    }
    console.error(
      `[${agent}] end runId=${input.runId} status=failed error=${error}`,
    );
    await publishProgress(input.runId, {
      agent,
      status: "failed",
      artifactRoot: input.artifactRoot,
      error,
    });
    await finalizeRunStatus(input.runId, "failed", error);
    throw err;
  }
}

async function readRegistry(root: string): Promise<ComponentRegistry> {
  const raw = await readFile(path.join(root, "component-registry.json"), "utf8");
  return JSON.parse(raw) as ComponentRegistry;
}

async function readInjections(root: string): Promise<TestIdInjections> {
  const raw = await readFile(path.join(root, "testid-injections.json"), "utf8");
  return JSON.parse(raw) as TestIdInjections;
}

async function scriptAnalystImpl(input: PipelineInput): Promise<void> {
  throwIfCancelled();

  const registry = await runScriptAnalyst({
    projectId: input.projectId,
    runId: input.runId,
    frontendPath: input.frontendPath,
  });

  const out = path.join(input.artifactRoot, "component-registry.json");
  await writeJson(out, registry);
  await insertArtifactIndex(input.runId, "scriptAnalyst", "registry", relKey(input, out), {
    componentCount: registry.components.length,
  });

  throwIfCancelled();
}

export async function scriptAnalyst(input: PipelineInput): Promise<void> {
  return withArtifactStaging(input, (inp, staging) =>
    runGenerationAgent(inp, "scriptAnalyst", () => scriptAnalystImpl(inp), staging),
  );
}

async function stageManagerImpl(input: PipelineInput): Promise<void> {
  throwIfCancelled();

  const registry = await readRegistry(input.artifactRoot);
  const apply = input.applyTestIds === true;
  const injections = runStageManager(registry, {
    dryRun: !apply,
    repoRoot: input.frontendPath,
    runId: input.runId,
  });

  const out = path.join(input.artifactRoot, "testid-injections.json");
  await writeJson(out, injections);
  await insertArtifactIndex(input.runId, "stageManager", "injections", relKey(input, out), {
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
    await insertArtifactIndex(input.runId, "stageManager", "apply-report", relKey(input, reportPath), {
      applied: report.applied,
      failed: report.failed,
    });
  }

  throwIfCancelled();
}

export async function stageManager(input: PipelineInput): Promise<void> {
  return withArtifactStaging(input, (inp, staging) =>
    runGenerationAgent(inp, "stageManager", () => stageManagerImpl(inp), staging),
  );
}

async function blockingCoachImpl(input: PipelineInput): Promise<void> {
  throwIfCancelled();

  const registry = await readRegistry(input.artifactRoot);
  const injections = await readInjections(input.artifactRoot);
  const catalog = runBlockingCoach(registry, injections);

  const out = path.join(input.artifactRoot, "locator-catalog.json");
  await writeJson(out, catalog);
  await insertArtifactIndex(input.runId, "blockingCoach", "locators", relKey(input, out), {
    locatorCount: catalog.locators.length,
  });

  throwIfCancelled();
}

export async function blockingCoach(input: PipelineInput): Promise<void> {
  return withArtifactStaging(input, (inp, staging) =>
    runGenerationAgent(inp, "blockingCoach", () => blockingCoachImpl(inp), staging),
  );
}

async function setDesignerImpl(input: PipelineInput): Promise<void> {
  throwIfCancelled();

  const registry = await readRegistry(input.artifactRoot);
  const catalogRaw = await readFile(
    path.join(input.artifactRoot, "locator-catalog.json"),
    "utf8",
  );
  const catalog = JSON.parse(catalogRaw) as LocatorCatalog;

  const pomFiles = await runSetDesigner(registry, catalog);
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
      relKey(input, filePath),
    );
  }

  throwIfCancelled();
}

export async function setDesigner(input: PipelineInput): Promise<void> {
  return withArtifactStaging(input, (inp, staging) =>
    runGenerationAgent(inp, "setDesigner", () => setDesignerImpl(inp), staging),
  );
}

async function choreographerImpl(input: PipelineInput): Promise<void> {
  throwIfCancelled();

  const registry = await readRegistry(input.artifactRoot);
  const pomDir = path.join(input.artifactRoot, "poms");
  const availablePoms = await resolveAvailablePomsFromDir(pomDir);
  console.info(
    `[choreographer] availablePoms=${availablePoms.join(", ")} runId=${input.runId}`,
  );

  const doc = await runChoreographer({
    registry,
    targetUrl: input.targetUrl,
    availablePoms,
  });

  console.info(
    `[choreographer] journeyCount=${doc.journeys.length} runId=${input.runId}`,
  );

  const out = path.join(input.artifactRoot, "journeys.json");
  await writeJson(out, doc);
  await insertArtifactIndex(input.runId, "choreographer", "journeys", relKey(input, out), {
    journeyCount: doc.journeys.length,
  });

  throwIfCancelled();
}

export async function choreographer(input: PipelineInput): Promise<void> {
  return withArtifactStaging(input, (inp, staging) =>
    runGenerationAgent(inp, "choreographer", () => choreographerImpl(inp), staging),
  );
}

async function assistantDirectorImpl(input: PipelineInput): Promise<void> {
  throwIfCancelled();

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

  const registry = await readRegistry(input.artifactRoot);
  const specs = await runAssistantDirector({
    journeysDoc,
    catalog,
    pomsDir,
    targetUrl: input.targetUrl,
    e2eAuth: input.e2eAuth,
    registry,
    artifactRoot: input.artifactRoot,
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
      relKey(input, filePath),
      { journeyId: spec.journeyId },
    );
  }

  throwIfCancelled();
  if (input.executeAfterGenerate === false) {
    await finalizeRunStatus(input.runId, "completed");
  }
}

export async function assistantDirector(input: PipelineInput): Promise<void> {
  return withArtifactStaging(input, (inp, staging) =>
    runGenerationAgent(
      inp,
      "assistantDirector",
      () => assistantDirectorImpl(inp),
      staging,
    ),
  );
}

export interface ContinuityLeadResult {
  failed: number;
  passed: number;
  total: number;
}

async function continuityLeadImpl(
  input: PipelineInput,
  staging: StagingContext,
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

  const reportMode =
    input.executionMode === "auto" || input.executionMode == null
      ? "direct"
      : input.executionMode;
  const out = path.join(input.artifactRoot, "execution-report.json");
  let report: Awaited<ReturnType<typeof runContinuityLead>> | undefined;

  const activityContext = Context.current();
  const abortController = new AbortController();
  const onActivityCancel = () => abortController.abort();
  activityContext.cancellationSignal.addEventListener(
    "abort",
    onActivityCancel,
    { once: true },
  );

  try {
    report = await runContinuityLead({
      projectId: input.projectId,
      runId: input.runId,
      artifactRoot: input.artifactRoot,
      frontendPath: input.frontendPath,
      targetUrl: input.targetUrl,
      e2eAuth: input.e2eAuth,
      executionMode: input.executionMode,
      platformBaseUrl: process.env.PLATFORM_BASE_URL,
      projectName: input.projectId,
      journeyIds: input.journeyIds,
      shouldCancel: () => activityContext.cancellationSignal.aborted,
      abortSignal: abortController.signal,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (error.includes("cancelled")) {
      console.info(
        `[continuityLead] end runId=${input.runId} status=cancelled`,
      );
      await updateExecutionStatus(input.runId, null, input.executionMode);
      await clearRunCurrentAgent(input.runId);
      await finalizeRunStatus(input.runId, "cancelled");
      await publishProgress(input.runId, {
        agent: "continuityLead",
        status: "cancelled",
        artifactRoot: input.artifactRoot,
      });
      throw err;
    }
    report = buildExecutionReport(
      [
        {
          journeyId: "_activity_error",
          title: "Continuity Lead activity error",
          status: "failed",
          attempts: 0,
          error: error.slice(0, 2000),
          executionMode: reportMode,
        },
      ],
      reportMode,
    );
    await writeJson(out, report);
    await insertArtifactIndex(
      input.runId,
      "continuityLead",
      "execution-report",
      relKey(input, out),
      {
        passed: report.summary.passed,
        failed: report.summary.failed,
      },
    );
    console.error(
      `[continuityLead] end runId=${input.runId} status=failed error=${error}`,
    );
    await updateExecutionStatus(input.runId, "failed", input.executionMode);
    await clearRunCurrentAgent(input.runId);
    await finalizeRunStatus(input.runId, "failed", error);
    await staging.flush();
    await publishProgress(input.runId, {
      agent: "continuityLead",
      status: "execution-failed",
      artifactRoot: input.artifactRoot,
      error,
    });
    throw err;
  } finally {
    activityContext.cancellationSignal.removeEventListener(
      "abort",
      onActivityCancel,
    );
  }

  await writeJson(out, report!);
  await insertArtifactIndex(input.runId, "continuityLead", "execution-report", relKey(input, out), {
    passed: report.summary.passed,
    failed: report.summary.failed,
  });

  throwIfCancelled();
  const execStatus = report.summary.failed === 0 ? "completed" : "failed";
  await updateExecutionStatus(input.runId, execStatus, input.executionMode);
  await clearRunCurrentAgent(input.runId);
  await finalizeRunStatus(
    input.runId,
    execStatus,
    report.summary.failed > 0
      ? `${report.summary.failed} journey(s) failed`
      : null,
  );
  await staging.flush();
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
    `[continuityLead] end runId=${input.runId} status=ok mode=${report.executionMode} passed=${report.summary.passed} failed=${report.summary.failed} flaky=${report.summary.flaky ?? 0} skipped=${report.summary.skipped}`,
  );

  return {
    failed: report.summary.failed,
    passed: report.summary.passed,
    total: report.summary.total,
  };
}

export async function continuityLead(
  input: PipelineInput,
): Promise<ContinuityLeadResult> {
  return withArtifactStaging(input, (inp, staging) =>
    continuityLeadImpl(inp, staging),
  );
}
