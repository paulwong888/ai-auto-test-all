import { Router } from "express";
import { isAppError } from "../errors.js";
import { requireProjectRole } from "../middleware/auth.js";
import { projectEnvSettingsInputSchema } from "../schemas/project-env.js";
import type { ProjectEnvService } from "../services/project-env-service.js";
import { projectIdFromRequest } from "../utils/route-params.js";

const projectId = projectIdFromRequest;

export function createProjectEnvSettingsRouter(projectEnvService: ProjectEnvService): Router {
  const router = Router({ mergeParams: true });

  router.get("/settings/env", requireProjectRole("owner", "editor", "viewer"), async (req, res) => {
    try {
      const settings = await projectEnvService.getSettings(projectId(req));
      res.json({ ok: true, data: settings });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put("/settings/env", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const parsed = projectEnvSettingsInputSchema.parse(req.body ?? {});
      const settings = await projectEnvService.updateSettings(projectId(req), parsed);
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
