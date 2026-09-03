import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PipelineInput } from "@monday/agent-core/workflow";
import {
  runScriptAnalyst,
  runStageManager,
  runBlockingCoach,
  runSetDesigner,
  type ComponentRegistry,
  type TestIdInjections,
  type LocatorCatalog,
} from "@monday/agent-core";
import { publishProgress } from "../lib/redis.js";
import { insertArtifactIndex } from "../lib/db.js";

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function notify(
  input: PipelineInput,
  agent: string,
  status: string,
): Promise<void> {
  await publishProgress(input.runId, {
    agent,
    status,
    artifactRoot: input.artifactRoot,
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

  await notify(input, "scriptAnalyst", "completed");
}

export async function stageManager(input: PipelineInput): Promise<void> {
  await notify(input, "stageManager", "started");

  const registry = await readRegistry(input.artifactRoot);
  const injections = runStageManager(registry);

  const out = path.join(input.artifactRoot, "testid-injections.json");
  await writeJson(out, injections);
  await insertArtifactIndex(input.runId, "stageManager", "injections", out, {
    patchCount: injections.patches.length,
  });

  await notify(input, "stageManager", "completed");
}

export async function blockingCoach(input: PipelineInput): Promise<void> {
  await notify(input, "blockingCoach", "started");

  const registry = await readRegistry(input.artifactRoot);
  const injections = await readInjections(input.artifactRoot);
  const catalog = runBlockingCoach(registry, injections);

  const out = path.join(input.artifactRoot, "locator-catalog.json");
  await writeJson(out, catalog);
  await insertArtifactIndex(input.runId, "blockingCoach", "locators", out, {
    locatorCount: catalog.locators.length,
  });

  await notify(input, "blockingCoach", "completed");
}

export async function setDesigner(input: PipelineInput): Promise<void> {
  await notify(input, "setDesigner", "started");

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
    const filePath = path.join(pomDir, pom.fileName);
    await writeFile(filePath, pom.content, "utf8");
    await insertArtifactIndex(
      input.runId,
      "setDesigner",
      "pom",
      filePath,
    );
  }

  await notify(input, "setDesigner", "completed");
}

export async function choreographer(input: PipelineInput): Promise<void> {
  await notify(input, "choreographer", "started");
  const out = path.join(input.artifactRoot, "journeys.json");
  await writeJson(out, {
    journeys: [
      {
        id: "stub-journey",
        title: "Stub user journey (M3)",
        gherkinText:
          "Scenario: Stub\\n  Given app is ready\\n  When user opens home\\n  Then page loads",
        steps: ["navigateToHome", "assertPageReady"],
      },
    ],
    note: "M3 will generate real journeys from registry",
  });
  await notify(input, "choreographer", "completed");
}

export async function assistantDirector(input: PipelineInput): Promise<void> {
  await notify(input, "assistantDirector", "started");
  const testsDir = path.join(input.artifactRoot, "tests");
  await ensureDir(testsDir);
  await writeFile(
    path.join(testsDir, "sample.spec.ts"),
    `import { test, expect } from '@playwright/test';\n\ntest('stub sample (M3)', async ({ page }) => {\n  await page.goto(${JSON.stringify(input.targetUrl ?? "/")});\n  expect(true).toBeTruthy();\n});\n`,
    "utf8",
  );
  await notify(input, "assistantDirector", "completed");
}
