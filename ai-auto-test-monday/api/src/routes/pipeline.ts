import { Router } from "express";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  executePipelineSchema,
  resumePipelineSchema,
  runPipelineSchema,
} from "@monday/agent-core";
import {
  cancelPipeline,
  executePipelineRun,
  getPipelineRun,
  listArtifactsFromIndex,
  listRuns,
  resumePipelineRun,
  startPipeline,
} from "../services/pipeline-service.js";

const ARTIFACT_FILES: Record<string, string> = {
  registry: "component-registry.json",
  injections: "testid-injections.json",
  locators: "locator-catalog.json",
  journeys: "journeys.json",
  "execution-report": "execution-report.json",
  "apply-report": "apply-report.json",
};

const ARTIFACT_TEXT_FILES: Record<string, string> = {};

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function listArtifactFiles(artifactRoot: string): Promise<
  Array<{ key: string; label: string; kind: "json" | "text" }>
> {
  const items: Array<{ key: string; label: string; kind: "json" | "text" }> = [
    { key: "registry", label: "component-registry.json", kind: "json" },
    { key: "injections", label: "testid-injections.json", kind: "json" },
    { key: "locators", label: "locator-catalog.json", kind: "json" },
    { key: "journeys", label: "journeys.json", kind: "json" },
  ];

  const pomDir = path.join(artifactRoot, "poms");
  try {
    const poms = await readdir(pomDir);
    for (const file of poms.filter((f) => f.endsWith(".ts")).sort()) {
      items.push({
        key: `pom-${file}`,
        label: `poms/${file}`,
        kind: "text",
      });
    }
  } catch {
    // no poms yet
  }

  const testsDir = path.join(artifactRoot, "tests");
  try {
    const specs = await readdir(testsDir);
    for (const file of specs.filter((f) => f.endsWith(".spec.ts")).sort()) {
      items.push({
        key: `spec-${file}`,
        label: `tests/${file}`,
        kind: "text",
      });
    }
  } catch {
    // no tests yet
  }

  return items;
}

export function createPipelineRouter(): Router {
  const router = Router();

  router.post("/run", async (req, res) => {
    const parsed = runPipelineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await startPipeline(parsed.data.projectId, {
        applyTestIds: parsed.data.applyTestIds,
        executeAfterGenerate: parsed.data.executeAfterGenerate,
        executionMode: parsed.data.executionMode,
      });
      res.status(202).json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not ready") ? 400 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.get("/runs", async (req, res) => {
    const projectId =
      typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const runs = await listRuns(projectId);
    res.json({ ok: true, runs });
  });

  router.get("/runs/:runId", async (req, res) => {
    try {
      const data = await getPipelineRun(req.params.runId);
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(404).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/runs/:runId/cancel", async (req, res) => {
    try {
      await cancelPipeline(req.params.runId);
      res.json({ ok: true, message: "Pipeline cancelled" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 409;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.post("/runs/:runId/execute", async (req, res) => {
    const parsed = executePipelineSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await executePipelineRun(req.params.runId, {
        executionMode: parsed.data.executionMode,
        journeyIds: parsed.data.journeyIds,
      });
      res.status(202).json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found")
        ? 404
        : message.includes("not ready") ||
            message.includes("already in progress") ||
            message.includes("No generated spec") ||
            message.includes("Unknown journeyIds")
          ? 409
          : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.post("/runs/:runId/resume", async (req, res) => {
    const parsed = resumePipelineSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await resumePipelineRun(req.params.runId, {
        fromAgent: parsed.data.fromAgent,
        executeAfterGenerate: parsed.data.executeAfterGenerate,
        executionMode: parsed.data.executionMode,
        applyTestIds: parsed.data.applyTestIds,
      });
      res.status(202).json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found")
        ? 404
        : message.includes("already in progress") ||
            message.includes("Invalid fromAgent") ||
            message.includes("Artifact root not found")
          ? 409
          : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.get("/runs/:runId/artifacts/list", async (req, res) => {
    try {
      const { run } = await getPipelineRun(req.params.runId);
      const artifactRoot = String(run.artifact_root);
      const indexed = await listArtifactsFromIndex(req.params.runId, artifactRoot);
      const files =
        indexed.length > 0
          ? indexed.map((f) => ({
              key: f.key,
              label: f.label,
              kind: f.kind,
              agent: f.agent,
              summary: f.summary,
              available: f.available,
            }))
          : (await listArtifactFiles(artifactRoot)).map((f) => ({
              ...f,
              available: true,
            }));
      res.json({ ok: true, files, source: indexed.length > 0 ? "index" : "filesystem" });
    } catch (err) {
      res.status(404).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/runs/:runId/artifacts/:name", async (req, res) => {
    try {
      const { run } = await getPipelineRun(req.params.runId);
      const artifactRoot = String(run.artifact_root);
      const name = req.params.name;

      if (name.startsWith("pom-")) {
        const fileName = name.slice(4);
        const filePath = path.join(artifactRoot, "poms", fileName);
        const content = await readFile(filePath, "utf8");
        res.type("text/plain").send(content);
        return;
      }

      if (name.startsWith("spec-")) {
        const fileName = name.slice(5);
        const filePath = path.join(artifactRoot, "tests", fileName);
        const content = await readFile(filePath, "utf8");
        res.type("text/plain").send(content);
        return;
      }

      const textRel = ARTIFACT_TEXT_FILES[name];
      if (textRel) {
        const content = await readFile(path.join(artifactRoot, textRel), "utf8");
        res.type("text/plain").send(content);
        return;
      }

      const file = ARTIFACT_FILES[name];
      if (!file) {
        res.status(404).json({ ok: false, error: "unknown artifact name" });
        return;
      }
      const content = await readFile(path.join(artifactRoot, file), "utf8");
      res.type("application/json").send(content);
    } catch (err) {
      if (isEnoent(err)) {
        res.status(404).json({
          ok: false,
          code: "ARTIFACT_NOT_READY",
          error: `Artifact not ready: ${req.params.name}`,
        });
        return;
      }
      res.status(404).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
