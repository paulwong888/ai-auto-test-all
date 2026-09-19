import { Router } from "express";
import { isAppError } from "../errors.js";
import { requireProjectRole } from "../middleware/auth.js";
import type { RunService } from "../services/run-service.js";

function projectId(req: import("express").Request): string {
  const id = (req.params as { id?: string }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("Missing project id");
  }
  return id;
}

export function createRunRouter(runService: RunService): Router {
  const router = Router({ mergeParams: true });

  router.post("/run", requireProjectRole("owner", "editor", "ci_bot"), async (req, res) => {
    try {
      const run = await runService.startRun(projectId(req), {
        preset: req.body?.preset,
        headed: req.body?.headed,
        slowmo: req.body?.slowmo,
        specFilter: req.body?.specFilter ?? null,
        nodeIds: Array.isArray(req.body?.nodeIds) ? req.body.nodeIds : undefined,
        rerunFailedOnly: req.body?.rerunFailedOnly === true,
        previousRunId: req.body?.previousRunId ?? null,
      });
      res.status(202).json({
        ok: true,
        data: {
          runId: run.id,
          jobId: run.jobId,
          status: run.status,
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs", requireProjectRole("owner", "editor", "viewer", "ci_bot"), async (req, res) => {
    try {
      const runs = await runService.listRuns(projectId(req));
      res.json({ ok: true, data: { runs } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId", async (req, res) => {
    try {
      const id = projectId(req);
      const runId = req.params.runId!;
      const run = await runService.getRun(id, runId);
      if (!run) {
        res.status(404).json({
          ok: false,
          error: { code: "RUN_NOT_FOUND", message: "Run not found" },
        });
        return;
      }
      res.json({
        ok: true,
        data: {
          ...run,
          reportUrl: `/api/projects/${id}/runs/${runId}/report`,
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/report", async (req, res) => {
    try {
      const reportPath = await runService.getReportPath(projectId(req), req.params.runId!);
      res.type("html").sendFile(reportPath);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/traces/:name", async (req, res) => {
    try {
      const tracePath = await runService.getTracePath(
        projectId(req),
        req.params.runId!,
        req.params.name!,
      );
      res.type("application/zip").sendFile(tracePath);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/traces", async (req, res) => {
    try {
      const relPath = typeof req.query.path === "string" ? req.query.path : "";
      if (!relPath) {
        res.status(422).json({
          ok: false,
          error: { code: "PATH_REQUIRED", message: "path query parameter is required" },
        });
        return;
      }
      const tracePath = await runService.getTracePath(
        projectId(req),
        req.params.runId!,
        relPath,
      );
      res.type("application/zip").sendFile(tracePath);
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
