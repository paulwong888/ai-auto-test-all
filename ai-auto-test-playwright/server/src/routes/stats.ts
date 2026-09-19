import { Router } from "express";
import { isAppError } from "../errors.js";
import { RunRepository } from "../repositories/run-repository.js";
import { compareRuns } from "../services/run-compare-service.js";

function projectId(req: import("express").Request): string {
  const id = (req.params as { id?: string }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("Missing project id");
  }
  return id;
}

export function createStatsRouter(): Router {
  const router = Router({ mergeParams: true });
  const runs = new RunRepository();

  router.get("/runs/compare", async (req, res) => {
    try {
      const runA = typeof req.query.runA === "string" ? req.query.runA : "";
      const runB = typeof req.query.runB === "string" ? req.query.runB : "";
      if (!runA || !runB) {
        res.status(422).json({
          ok: false,
          error: { code: "INVALID_QUERY", message: "runA and runB are required" },
        });
        return;
      }
      const pid = projectId(req);
      const a = await runs.findById(runA);
      const b = await runs.findById(runB);
      if (!a || a.projectId !== pid || !b || b.projectId !== pid) {
        res.status(404).json({
          ok: false,
          error: { code: "RUN_NOT_FOUND", message: "One or both runs not found" },
        });
        return;
      }
      res.json({ ok: true, data: compareRuns(a, b) });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/stats/trend", async (req, res) => {
    try {
      const days = Number(req.query.days ?? 7);
      const trend = await runs.trendByProject(projectId(req), days);
      res.json({ ok: true, data: { trend } });
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
