import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ExecutionReport,
  ExecutionResult,
  Journey,
  JourneysDocument,
} from "../artifacts/types.js";
import { journeysToFeatures } from "../lib/journeys-to-features.js";
import { materializeArtifacts } from "../lib/materialize-artifacts.js";
import {
  mapRepoPathForPlatform,
  PlatformClient,
} from "../lib/platform-client.js";
import {
  buildExecutionReport,
  mergeExecutionReport,
} from "../lib/merge-execution-report.js";
import { e2eAuthToEnv } from "../lib/e2e-auth.js";
import { ensurePlaywrightBrowsers, runPlaywrightSpec } from "../lib/playwright-direct.js";
import type { E2eAuthConfig } from "../types.js";
import type { ExecutionMode } from "../workflow.js";

export interface ContinuityLeadInput {
  projectId: string;
  runId: string;
  artifactRoot: string;
  frontendPath: string;
  targetUrl?: string;
  e2eAuth?: E2eAuthConfig;
  executionMode?: ExecutionMode;
  platformBaseUrl?: string;
  projectName?: string;
  journeyIds?: string[];
  /** When true, stop between journey runs (Temporal activity cancellation). */
  shouldCancel?: () => boolean;
  /** Aborts the in-flight Playwright subprocess when cancelled. */
  abortSignal?: AbortSignal;
}

function throwIfCancelled(shouldCancel?: () => boolean): void {
  if (shouldCancel?.()) {
    throw new Error("Activity cancelled");
  }
}

function filterSpecFilesByJourneyIds(
  specFiles: string[],
  journeyIds: string[] | undefined,
): string[] {
  if (!journeyIds?.length) return specFiles;
  const idSet = new Set(journeyIds);
  return specFiles.filter((specPath) =>
    idSet.has(path.basename(specPath, ".spec.ts")),
  );
}

function filterJourneysByIds(
  journeys: JourneysDocument["journeys"],
  journeyIds: string[] | undefined,
): JourneysDocument["journeys"] {
  if (!journeyIds?.length) return journeys;
  const idSet = new Set(journeyIds);
  return journeys.filter((j) => idSet.has(j.id));
}

async function loadPreviousReport(
  artifactRoot: string,
): Promise<ExecutionReport | null> {
  try {
    const raw = await readFile(
      path.join(artifactRoot, "execution-report.json"),
      "utf8",
    );
    return JSON.parse(raw) as ExecutionReport;
  } catch {
    return null;
  }
}

function classifyFailure(error: string): "A" | "B" | "C" {
  const lower = error.toLowerCase();
  if (
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  ) {
    return "C";
  }
  if (
    lower.includes("testid") ||
    lower.includes("locator") ||
    lower.includes("getby") ||
    lower.includes("not found")
  ) {
    return "B";
  }
  return "A";
}

function buildJourneyById(journeys: Journey[]): Map<string, Journey> {
  return new Map(journeys.map((j) => [j.id, j]));
}

function formatExecutionProgress(
  results: ExecutionResult[],
  total: number,
): string {
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "passed") passed += 1;
    else if (r.status === "failed" || r.status === "flaky") failed += 1;
  }
  return `total=${total} passed=${passed} failed=${failed}`;
}

async function runDirectForJourneys(
  repoPath: string,
  targetUrl: string,
  specFiles: string[],
  journeyById: Map<string, Journey>,
  e2eEnv?: Record<string, string>,
  shouldCancel?: () => boolean,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult[]> {
  console.info(
    `[continuityLead] direct execution repo=${repoPath} target=${targetUrl} specs=${specFiles.length}`,
  );
  await ensurePlaywrightBrowsers(repoPath);
  const results: ExecutionResult[] = [];
  const total = specFiles.length;
  for (const specPath of specFiles) {
    throwIfCancelled(shouldCancel);
    const rel = path.relative(repoPath, specPath).replace(/\\/g, "/");
    const journeyId = path.basename(specPath, ".spec.ts");
    let attempts = 0;
    let lastError = "";
    let passed = false;
    let durationMs = 0;

    const progress = () => formatExecutionProgress(results, total);
    console.info(
      `[continuityLead] direct journey=${journeyId} spec=${rel} ${progress()}`,
    );

    while (attempts < 3 && !passed) {
      throwIfCancelled(shouldCancel);
      attempts += 1;
      console.info(
        `[continuityLead] direct journey=${journeyId} attempt=${attempts}/3 ${progress()}`,
      );
      const run = await runPlaywrightSpec({
        repoPath,
        targetUrl,
        specFile: rel,
        e2eEnv,
        abortSignal,
      });
      if (shouldCancel?.()) {
        throw new Error("Activity cancelled");
      }
      durationMs = run.durationMs;
      if (run.success) {
        passed = true;
      } else {
        lastError = run.stderr || run.stdout;
        const type = classifyFailure(lastError);
        const errLine =
          lastError.split("\n").find((l) => /Error|TypeError|expect\(/.test(l)) ??
          lastError.slice(0, 120);
        console.info(
          `[continuityLead] direct journey=${journeyId} attempt=${attempts} failed type=${type} ${progress()} ${errLine.replace(/\s+/g, " ").trim()}`,
        );
        if (type !== "C") break;
      }
    }

    const status = passed
      ? "passed"
      : attempts > 1 && classifyFailure(lastError) === "C"
        ? "flaky"
        : "failed";
    const journey = journeyById.get(journeyId);
    results.push({
      journeyId,
      title: journey?.name ?? journeyId,
      status,
      failureType: passed ? undefined : classifyFailure(lastError),
      attempts,
      error: passed ? undefined : lastError.slice(0, 2000),
      durationMs,
      executionMode: "direct",
    });
    console.info(
      `[continuityLead] direct journey=${journeyId} ${status} attempts=${attempts} durationMs=${durationMs} ${formatExecutionProgress(results, total)}`,
    );
  }
  return results;
}

export async function runContinuityLead(
  input: ContinuityLeadInput,
): Promise<ExecutionReport> {
  throwIfCancelled(input.shouldCancel);
  const targetUrl = input.targetUrl ?? "http://localhost:3000";
  const mode = input.executionMode ?? "auto";
  const e2eEnv = input.e2eAuth ? e2eAuthToEnv(input.e2eAuth) : undefined;
  const platformUrl =
    input.platformBaseUrl ?? process.env.PLATFORM_BASE_URL ?? "http://host.docker.internal:3001";

  const journeysRaw = await readFile(
    path.join(input.artifactRoot, "journeys.json"),
    "utf8",
  );
  const journeysDoc = JSON.parse(journeysRaw) as JourneysDocument;
  const journeysToRun = filterJourneysByIds(
    journeysDoc.journeys,
    input.journeyIds,
  );
  const journeyById = buildJourneyById(journeysDoc.journeys);

  const { specFiles: allSpecFiles } = await materializeArtifacts(
    input.artifactRoot,
    input.frontendPath,
  );
  const specFiles = filterSpecFilesByJourneyIds(
    allSpecFiles,
    input.journeyIds,
  );

  let usedMode: "platform" | "direct" = "direct";
  let results: ExecutionResult[] = [];

  const platform = new PlatformClient(platformUrl);
  const platformAvailable =
    mode !== "direct" && (await platform.healthCheck());

  console.info(
    `[continuityLead] runId=${input.runId} requestedMode=${mode} platformAvailable=${platformAvailable} specs=${specFiles.length} journeys=${journeysToRun.length}`,
  );

  if (platformAvailable && specFiles.length > 0) {
    try {
      usedMode = "platform";
      console.info(
        `[continuityLead] platform execution url=${platformUrl} journeys=${journeysToRun.length}`,
      );
      const repoPath = mapRepoPathForPlatform(input.frontendPath);
      const project = await platform.ensureProject({
        id: input.projectId,
        name: input.projectName ?? input.projectId,
        repoPath,
        targetUrl,
      });

      try {
        await platform.initTemplate(project.id);
      } catch {
        // template may already exist
      }

      const features = journeysToFeatures(journeysDoc, repoPath);
      await platform.importFeatures(project.id, features);

      const platformTotal = journeysToRun.length;
      for (const journey of journeysToRun) {
        throwIfCancelled(input.shouldCancel);
        let attempts = 0;
        let passed = false;
        let lastMessage = "";
        const progress = () => formatExecutionProgress(results, platformTotal);

        console.info(
          `[continuityLead] platform journey=${journey.id} ${progress()}`,
        );

        while (attempts < 3 && !passed) {
          throwIfCancelled(input.shouldCancel);
          attempts += 1;
          console.info(
            `[continuityLead] platform journey=${journey.id} attempt=${attempts}/3 ${progress()}`,
          );
          await platform.runFeature(project.id, journey.id);
          const outcome = await platform.waitForRunComplete();
          passed = outcome.success;
          lastMessage = outcome.message;
          if (!passed) {
            console.info(
              `[continuityLead] platform journey=${journey.id} attempt=${attempts} failed ${progress()} ${lastMessage.slice(0, 120).replace(/\s+/g, " ")}`,
            );
          }
          if (!passed && classifyFailure(lastMessage) !== "C") break;
        }

        const status = passed
          ? "passed"
          : attempts > 1 && classifyFailure(lastMessage) === "C"
            ? "flaky"
            : "failed";
        results.push({
          journeyId: journey.id,
          title: journey.name,
          status,
          failureType: passed ? undefined : classifyFailure(lastMessage),
          attempts,
          error: passed ? undefined : lastMessage.slice(0, 2000),
          executionMode: "platform",
        });
        console.info(
          `[continuityLead] platform journey=${journey.id} ${status} attempts=${attempts} ${formatExecutionProgress(results, platformTotal)}`,
        );
      }
    } catch (err) {
      if (mode === "platform") {
        throw err;
      }
      usedMode = "direct";
      results = await runDirectForJourneys(
        input.frontendPath,
        targetUrl,
        specFiles,
        journeyById,
        e2eEnv,
        input.shouldCancel,
        input.abortSignal,
      );
    }
  } else {
    if (specFiles.length === 0) {
      results = journeysToRun.map((j) => ({
        journeyId: j.id,
        title: j.name,
        status: "skipped" as const,
        attempts: 0,
        error: "No generated spec files",
        executionMode: "direct" as const,
      }));
    } else {
      results = await runDirectForJourneys(
        input.frontendPath,
        targetUrl,
        specFiles,
        journeyById,
        e2eEnv,
        input.shouldCancel,
        input.abortSignal,
      );
    }
  }

  const reportMode = (mode === "auto" ? usedMode : mode) as ExecutionReport["executionMode"];
  const previous = await loadPreviousReport(input.artifactRoot);

  if (input.journeyIds?.length) {
    return mergeExecutionReport(
      previous,
      results,
      input.journeyIds,
      reportMode,
    );
  }

  return buildExecutionReport(results, reportMode);
}
