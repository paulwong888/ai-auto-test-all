import { Router } from "express";
import { isAppError } from "../errors.js";
import { requireProjectRole } from "../middleware/auth.js";
import type { LlmConfigService } from "../services/llm-config-service.js";
import { projectLlmOverrideSchema } from "../schemas/llm-settings.js";
import { projectIdFromRequest } from "../utils/route-params.js";

const projectId = projectIdFromRequest;

export function createProjectLlmSettingsRouter(llmConfigService: LlmConfigService): Router {
  const router = Router({ mergeParams: true });

  router.get("/settings/llm", requireProjectRole("owner", "editor", "viewer"), async (req, res) => {
    try {
      const settings = await llmConfigService.getProjectOverride(projectId(req));
      res.json({ ok: true, data: settings });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put("/settings/llm", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const parsed = projectLlmOverrideSchema.parse(req.body ?? {});
      const settings = await llmConfigService.updateProjectOverride(projectId(req), parsed);
      res.json({ ok: true, data: settings });
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
