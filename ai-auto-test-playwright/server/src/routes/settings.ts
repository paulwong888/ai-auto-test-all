import { Router } from "express";
import { isAppError } from "../errors.js";
import { authDisabled, type AuthedRequest } from "../middleware/auth.js";
import type { LlmConfigService } from "../services/llm-config-service.js";
import { globalLlmSettingsSchema } from "../schemas/llm-settings.js";

export function createSettingsRouter(llmConfigService: LlmConfigService): Router {
  const router = Router();

  router.get("/llm", requireJwtUser, async (_req, res) => {
    try {
      const settings = await llmConfigService.getGlobal();
      res.json({ ok: true, data: settings });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put("/llm", requireJwtUser, async (req, res) => {
    try {
      const parsed = globalLlmSettingsSchema.parse(req.body ?? {});
      const settings = await llmConfigService.updateGlobal(parsed);
      res.json({ ok: true, data: settings });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function requireJwtUser(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction): void {
  if (req.apiTokenProjectId) {
    res.status(403).json({
      ok: false,
      error: { code: "TOKEN_SCOPE_DENIED", message: "API token cannot access global settings" },
    });
    return;
  }
  if (authDisabled()) {
    next();
    return;
  }
  if (!req.userId) {
    res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    return;
  }
  next();
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
