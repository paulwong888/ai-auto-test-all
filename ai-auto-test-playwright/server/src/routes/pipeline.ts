import { Router } from "express";
import { isAppError } from "../errors.js";
import type { PlatformPipelineService } from "../services/platform-pipeline-service.js";
import { requireProjectRole } from "../middleware/auth.js";
import { paramString, projectIdFromRequest } from "../utils/route-params.js";

const projectId = projectIdFromRequest;

export function createPipelineRouter(pipelineService: PlatformPipelineService): Router {
  const router = Router({ mergeParams: true });

  router.post("/pipeline/run", requireProjectRole("owner", "editor", "ci_bot"), async (req, res) => {
    try {
      const record = await pipelineService.startPlatformPipeline(projectId(req), {
        moduleName: typeof req.body?.moduleName === "string" ? req.body.moduleName : undefined,
        runPreset: req.body?.runPreset === "debug" ? "debug" : "ci",
        nodeIds: Array.isArray(req.body?.nodeIds)
          ? req.body.nodeIds.filter((v: unknown) => typeof v === "string")
          : undefined,
        autoFix: req.body?.autoFix !== false,
        maxFixIterations:
          typeof req.body?.maxFixIterations === "number" ? req.body.maxFixIterations : undefined,
        skipPlan: req.body?.skipPlan !== false,
        skipCodegen: req.body?.skipCodegen !== false,
      });
      res.status(202).json({
        ok: true,
        data: {
          pipelineRunId: record.id,
          temporalWorkflowId: record.temporalWorkflowId,
          status: record.status,
          currentStage: record.currentStage,
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/pipeline/runs", requireProjectRole("owner", "editor", "viewer", "ci_bot"), async (req, res) => {
    try {
      const runs = await pipelineService.listPlatformPipelines(projectId(req));
      res.json({ ok: true, data: { runs } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get(
    "/pipeline/runs/:pipelineRunId",
    requireProjectRole("owner", "editor", "viewer", "ci_bot"),
    async (req, res) => {
      try {
        const data = await pipelineService.getPlatformPipeline(
          projectId(req),
          paramString(req.params.pipelineRunId),
        );
        res.json({ ok: true, data });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  router.post(
    "/pipeline/runs/:pipelineRunId/cancel",
    requireProjectRole("owner", "editor"),
    async (req, res) => {
      try {
        await pipelineService.cancelPlatformPipeline(
          projectId(req),
          paramString(req.params.pipelineRunId),
        );
        res.json({ ok: true, data: { cancelled: true } });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

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
