import { Router } from "express";
import { isAppError } from "../errors.js";
import { TokenService } from "../services/token-service.js";
import type { RunService } from "../services/run-service.js";

export function createWebhooksRouter(runService: RunService): Router {
  const router = Router();
  const tokens = new TokenService();

  router.post("/ci/run", async (req, res) => {
    try {
      const header = req.headers.authorization;
      const raw = header?.startsWith("Bearer ") ? header.slice(7) : "";
      const { projectId } = await tokens.validateToken(raw, "run");
      const bodyProjectId = String(req.body?.projectId ?? projectId);
      if (bodyProjectId !== projectId) {
        res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Token not scoped to project" } });
        return;
      }
      const run = await runService.startRun(bodyProjectId, {
        preset: "ci",
        purpose: "run_ci",
        triggerSource: "ci",
      });
      res.status(202).json({
        ok: true,
        data: { jobId: run.jobId, runId: run.id, status: run.status },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function sendError(res: import("express").Response, err: unknown): void {
  if (isAppError(err)) {
    res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } });
    return;
  }
  res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: String(err) } });
}
