import { Router } from "express";
import { isAppError } from "../errors.js";
import { AuthService } from "../services/auth-service.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export function createAuthRouter(): Router {
  const router = Router();
  const auth = new AuthService();

  router.post("/register", async (req, res) => {
    try {
      const email = String(req.body?.email ?? "");
      const password = String(req.body?.password ?? "");
      const displayName = req.body?.displayName ? String(req.body.displayName) : undefined;
      if (!email || !password) {
        res.status(422).json({ ok: false, error: { code: "INVALID_BODY", message: "email and password required" } });
        return;
      }
      const data = await auth.register(email, password, displayName);
      res.status(201).json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const email = String(req.body?.email ?? "");
      const password = String(req.body?.password ?? "");
      const data = await auth.login(email, password);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.userId ? await auth.getUser(req.userId) : null;
      if (!user) {
        res.status(404).json({ ok: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
        return;
      }
      res.json({ ok: true, data: user });
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
