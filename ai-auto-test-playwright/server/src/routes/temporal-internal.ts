import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "../config.js";
import { isAppError } from "../errors.js";
import type { TemporalBlockingService } from "../services/temporal-blocking-service.js";
import type { PlatformPipelineService } from "../services/platform-pipeline-service.js";

function requireInternalToken(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = req.header("x-temporal-internal-token");
    if (!token || token !== config.temporal.internalToken) {
      res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Invalid temporal internal token" },
      });
      return;
    }
    next();
  };
}

export function createTemporalInternalRouter(
  config: AppConfig,
  blocking: TemporalBlockingService,
  pipelineService: PlatformPipelineService,
): Router {
  const router = Router();
  router.use(requireInternalToken(config));

  router.post("/plan", async (req, res) => {
    try {
      const data = await blocking.runPlan(req.body);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/codegen", async (req, res) => {
    try {
      const data = await blocking.runCodegen(req.body);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/run", async (req, res) => {
    try {
      const data = await blocking.runPytest(req.body);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/fix/analyze", async (req, res) => {
    try {
      const data = await blocking.runFixAnalyze(req.body);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/fix/apply", async (req, res) => {
    try {
      const data = await blocking.runFixApply(req.body);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/fix/verify", async (req, res) => {
    try {
      const data = await blocking.runFixVerify(req.body);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/pipeline/finish", async (req, res) => {
    try {
      const pipelineRunId = String(req.body?.pipelineRunId ?? "");
      const status = req.body?.status === "passed" ? "passed" : "failed";
      if (!pipelineRunId) {
        res.status(422).json({
          ok: false,
          error: { code: "PIPELINE_RUN_ID_REQUIRED", message: "pipelineRunId is required" },
        });
        return;
      }
      await pipelineService.getRepository().update(pipelineRunId, {
        status,
        currentStage: "done",
        error: typeof req.body?.error === "string" ? req.body.error : null,
        finishedAt: new Date().toISOString(),
        runId: typeof req.body?.runId === "string" ? req.body.runId : undefined,
        fixIteration:
          typeof req.body?.fixIteration === "number" ? req.body.fixIteration : undefined,
      });
      res.json({ ok: true, data: { pipelineRunId, status } });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function sendError(res: Response, err: unknown): void {
  if (isAppError(err)) {
    res.status(err.statusCode).json({
      ok: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ ok: false, error: { code: "INTERNAL_ERROR", message } });
}
