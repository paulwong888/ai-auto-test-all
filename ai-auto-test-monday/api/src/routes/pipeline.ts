import { Router } from "express";
import {
  executePipelineSchema,
  resumePipelineSchema,
  runPipelineSchema,
} from "@monday/agent-core";
import { runArtifactPrefix } from "../lib/artifact-store.js";
import {
  getArtifactText,
  getPomCatalog,
  putJourneysArtifact,
} from "../services/journeys-artifact-service.js";
import {
  cancelPipeline,
  executePipelineRun,
  getPipelineRun,
  listArtifactFilesFromStore,
  listArtifactsFromIndex,
  listRuns,
  resumePipelineRun,
  startPipeline,
} from "../services/pipeline-service.js";

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
      const status = message.includes("not ready")
        ? 400
        : message.includes("already has a running")
          ? 409
          : 500;
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
            message.includes("already has a running") ||
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
            message.includes("already has a running") ||
            message.includes("Invalid fromAgent") ||
            message.includes("Artifact prefix not found")
          ? 409
          : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.get("/runs/:runId/pom-catalog", async (req, res) => {
    try {
      const catalog = await getPomCatalog(req.params.runId);
      res.json({ ok: true, ...catalog });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes("not found") ? 404 : 500).json({
        ok: false,
        error: message,
      });
    }
  });

  router.put("/runs/:runId/artifacts/journeys", async (req, res) => {
    try {
      const result = await putJourneysArtifact(req.params.runId, req.body);
      res.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found")
        ? 404
        : message.includes("active") ||
            message.includes("not found for this run") ||
            message.includes("invalid") ||
            message.includes("unknown") ||
            message.includes("Duplicate") ||
            message.includes("empty") ||
            message.includes("no steps")
          ? 409
          : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.get("/runs/:runId/artifacts/list", async (req, res) => {
    try {
      const { run } = await getPipelineRun(req.params.runId);
      const prefix = runArtifactPrefix(run);
      const indexed = await listArtifactsFromIndex(req.params.runId, prefix);
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
          : (await listArtifactFilesFromStore(prefix)).map((f) => ({
              ...f,
              available: true,
            }));
      res.json({
        ok: true,
        files,
        source: indexed.length > 0 ? "index" : "store",
      });
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
      const result = await getArtifactText(run, req.params.name);
      if (!result) {
        res.status(404).json({
          ok: false,
          code: "ARTIFACT_NOT_READY",
          error: `Artifact not ready: ${req.params.name}`,
        });
        return;
      }
      res.type(result.contentType).send(result.content);
    } catch (err) {
      res.status(404).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
