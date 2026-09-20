import { Router } from "express";
import { isAppError } from "../errors.js";
import { requireProjectRole, type AuthedRequest } from "../middleware/auth.js";
import { AuthService } from "../services/auth-service.js";
import type { AuditService } from "../services/audit-service.js";

function projectId(req: import("express").Request): string {
  return (req.params as { id: string }).id;
}

export function createMembersRouter(auditService: AuditService): Router {
  const router = Router({ mergeParams: true });
  const auth = new AuthService();

  router.get("/members", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const members = await auth.listProjectMembers(projectId(req));
      res.json({ ok: true, data: { members } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/members", requireProjectRole("owner"), async (req: AuthedRequest, res) => {
    try {
      const email = String(req.body?.email ?? "");
      const role = String(req.body?.role ?? "viewer");
      if (!email) {
        res.status(422).json({ ok: false, error: { code: "EMAIL_REQUIRED", message: "email is required" } });
        return;
      }
      if (role !== "editor" && role !== "viewer") {
        res.status(422).json({ ok: false, error: { code: "INVALID_ROLE", message: "role must be editor or viewer" } });
        return;
      }
      const member = await auth.inviteMemberByEmail(projectId(req), email, role);
      await auditService.log({
        projectId: projectId(req),
        userId: req.userId ?? null,
        action: "member.invite",
        resource: member.email,
        metadata: { role: member.role, userId: member.userId },
      });
      res.status(201).json({ ok: true, data: member });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/members/:userId", requireProjectRole("owner"), async (req, res) => {
    try {
      const targetUserId = String(req.params.userId ?? "");
      await auth.removeProjectMember(projectId(req), targetUserId);
      res.json({ ok: true, data: { removed: true } });
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
