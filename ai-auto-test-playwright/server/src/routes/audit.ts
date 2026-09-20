import { Router } from "express";
import { isAppError } from "../errors.js";
import { requireProjectRole } from "../middleware/auth.js";
import type { AuditService } from "../services/audit-service.js";

function projectId(req: import("express").Request): string {
  return (req.params as { id: string }).id;
}

export function createAuditRouter(auditService: AuditService): Router {
  const router = Router({ mergeParams: true });

  router.get("/audit", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const logs = await auditService.listByProject(projectId(req), limit);
      res.json({ ok: true, data: { logs } });
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
