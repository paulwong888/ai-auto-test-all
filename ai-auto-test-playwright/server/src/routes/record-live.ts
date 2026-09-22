import { Router } from "express";
import { isAppError } from "../errors.js";
import { createVncToken } from "./vnc-tokens.js";
import type { RecorderService } from "../services/recorder-service.js";
import { authDisabled, requireProjectRole } from "../middleware/auth.js";
import { proxyVncHttp } from "./vnc-proxy.js";

function projectId(req: import("express").Request): string {
  return (req.params as { id: string }).id;
}

export function createRecordLiveRouter(recorder: RecorderService): Router {
  const router = Router({ mergeParams: true });

  router.post("/record/start", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const moduleName = String(req.body?.moduleName ?? "saucedemo");
      const targetUrl = String(req.body?.targetUrl ?? req.body?.baseUrl ?? "");
      if (!targetUrl) {
        res.status(422).json({ ok: false, error: { code: "TARGET_URL_REQUIRED", message: "targetUrl required" } });
        return;
      }
      const data = await recorder.startSession(projectId(req), moduleName, targetUrl);
      const userId = (req as { userId?: string }).userId ?? "anonymous";
      const vncToken = authDisabled() ? undefined : createVncToken(data.sessionId, userId, "record");
      res.status(201).json({ ok: true, data: { ...data, vncToken } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/record/stop", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const sessionId = String(req.body?.sessionId ?? "");
      if (!sessionId) {
        res.status(422).json({ ok: false, error: { code: "SESSION_ID_REQUIRED", message: "sessionId required" } });
        return;
      }
      const data = await recorder.stopSession(projectId(req), sessionId);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/record/session", async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId ?? "");
      if (!sessionId) {
        res.status(422).json({ ok: false, error: { code: "SESSION_ID_REQUIRED", message: "sessionId required" } });
        return;
      }
      const session = await recorder.getSession(projectId(req), sessionId);
      if (!session) {
        res.status(404).json({ ok: false, error: { code: "SESSION_NOT_FOUND", message: "Session not found" } });
        return;
      }
      res.json({ ok: true, data: session });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/record/:sessionId/vnc", async (req, res) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      res.redirect(302, `/api/projects/${projectId(req)}/record/${req.params.sessionId}/vnc/vnc.html${qs}`);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.use("/record/:sessionId/vnc", async (req, res) => {
    try {
      const subPath = req.path && req.path !== "/" ? req.path : "/vnc.html";
      await proxyVncHttp(req, res, recorder, projectId(req), req.params.sessionId!, subPath);
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
