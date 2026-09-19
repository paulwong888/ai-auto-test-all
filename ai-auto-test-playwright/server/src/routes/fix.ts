import { Router } from "express";
import { isAppError } from "../errors.js";
import type { FixService } from "../services/fix-service.js";

function projectId(req: import("express").Request): string {
  const id = (req.params as { id?: string }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("Missing project id");
  }
  return id;
}

export function createFixRouter(fixService: FixService): Router {
  const router = Router({ mergeParams: true });

  router.post("/fix/analyze", async (req, res) => {
    try {
      const runId = typeof req.body?.runId === "string" ? req.body.runId : "";
      if (!runId) {
        res.status(422).json({
          ok: false,
          error: { code: "RUN_ID_REQUIRED", message: "runId is required" },
        });
        return;
      }
      const job = await fixService.startFixAnalysis(projectId(req), runId);
      res.status(202).json({
        ok: true,
        data: { jobId: job.id, status: job.status },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/fix/apply", async (req, res) => {
    try {
      const suggestionId = typeof req.body?.suggestionId === "string" ? req.body.suggestionId : "";
      const patchIndexes = Array.isArray(req.body?.patchIndexes)
        ? req.body.patchIndexes.map(Number).filter((n: number) => Number.isFinite(n))
        : [];
      if (!suggestionId || patchIndexes.length === 0) {
        res.status(422).json({
          ok: false,
          error: { code: "INVALID_BODY", message: "suggestionId and patchIndexes are required" },
        });
        return;
      }
      const data = await fixService.applyFix(projectId(req), {
        suggestionId,
        patchIndexes,
        autoVerify: req.body?.autoVerify === true,
      });
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/fix/verify", async (req, res) => {
    try {
      const runId = typeof req.body?.runId === "string" ? req.body.runId : "";
      if (!runId) {
        res.status(422).json({
          ok: false,
          error: { code: "RUN_ID_REQUIRED", message: "runId is required" },
        });
        return;
      }
      const data = await fixService.verifyFix(projectId(req), runId);
      res.status(202).json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/fix/history", async (req, res) => {
    try {
      const runId = typeof req.query.runId === "string" ? req.query.runId : "";
      if (!runId) {
        res.status(422).json({
          ok: false,
          error: { code: "RUN_ID_REQUIRED", message: "runId query is required" },
        });
        return;
      }
      const data = await fixService.getFixHistory(projectId(req), runId);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/fix", async (req, res) => {
    try {
      const data = await fixService.getFixSuggestion(projectId(req), req.params.runId!);
      if (!data) {
        res.status(404).json({
          ok: false,
          error: { code: "FIX_NOT_FOUND", message: "Fix suggestion not found for this run" },
        });
        return;
      }
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function sendError(res: import("express").Response, err: unknown): void {
  if (isAppError(err)) {
    res.status(err.statusCode).json({
      ok: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message } });
}
