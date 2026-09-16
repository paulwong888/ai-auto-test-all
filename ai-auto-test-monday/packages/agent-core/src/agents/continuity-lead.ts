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
import { ensurePlaywrightBrowsers, runPlaywrightSpec } from "../lib/playwright-direct.js";
import type { ExecutionMode } from "../workflow.js";

export interface ContinuityLeadInput {
  projectId: string;
  runId: string;
  artifactRoot: string;
  frontendPath: string;
  targetUrl?: string;
  executionMode?: ExecutionMode;
  platformBaseUrl?: string;
  projectName?: string;
  journeyIds?: string[];
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

async function runDirectForJourneys(
  repoPath: string,
  targetUrl: string,
  specFiles: string[],
  journeyById: Map<string, Journey>,
): Promise<ExecutionResult[]> {
  console.info(
    `[continuityLead] direct execution repo=${repoPath} target=${targetUrl} specs=${specFiles.length}`,
  );
  await ensurePlaywrightBrowsers(repoPath);
  const results: ExecutionResult[] = [];
  for (const specPath of specFiles) {
    const rel = path.relative(repoPath, specPath).replace(/\\/g, "/");
    const journeyId = path.basename(specPath, ".spec.ts");
    let attempts = 0;
    let lastError = "";
    let passed = false;
    let durationMs = 0;

    console.info(`[continuityLead] direct journey=${journeyId} spec=${rel}`);

    while (attempts < 3 && !passed) {
      attempts += 1;
      console.info(
        `[continuityLead] direct journey=${journeyId} attempt=${attempts}/3`,
      );
      const run = await runPlaywrightSpec({
        repoPath,
        targetUrl,
        specFile: rel,
      });
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
          `[continuityLead] direct journey=${journeyId} attempt=${attempts} failed type=${type} ${errLine.replace(/\s+/g, " ").trim()}`,
        );
        if (type !== "C") break;
      }
    }

    const status = passed
      ? "passed"
      : attempts > 1 && classifyFailure(lastError) === "C"
        ? "flaky"
        : "failed";
    console.info(
      `[continuityLead] direct journey=${journeyId} ${status} attempts=${attempts} durationMs=${durationMs}`,
    );

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
  }
  return results;
}

export async function runContinuityLead(
  input: ContinuityLeadInput,
): Promise<ExecutionReport> {
  const targetUrl = input.targetUrl ?? "http://localhost:3000";
  const mode = input.executionMode ?? "auto";
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

      for (const journey of journeysToRun) {
        let attempts = 0;
        let passed = false;
        let lastMessage = "";

        console.info(`[continuityLead] platform journey=${journey.id}`);

        while (attempts < 3 && !passed) {
          attempts += 1;
          console.info(
            `[continuityLead] platform journey=${journey.id} attempt=${attempts}/3`,
          );
          await platform.runFeature(project.id, journey.id);
          const outcome = await platform.waitForRunComplete();
          passed = outcome.success;
          lastMessage = outcome.message;
          if (!passed) {
            console.info(
              `[continuityLead] platform journey=${journey.id} attempt=${attempts} failed ${lastMessage.slice(0, 120).replace(/\s+/g, " ")}`,
            );
          }
          if (!passed && classifyFailure(lastMessage) !== "C") break;
        }

        const status = passed
          ? "passed"
          : attempts > 1 && classifyFailure(lastMessage) === "C"
            ? "flaky"
            : "failed";
        console.info(
          `[continuityLead] platform journey=${journey.id} ${status} attempts=${attempts}`,
        );

        results.push({
          journeyId: journey.id,
          title: journey.name,
          status,
          failureType: passed ? undefined : classifyFailure(lastMessage),
          attempts,
          error: passed ? undefined : lastMessage.slice(0, 2000),
          executionMode: "platform",
        });
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
