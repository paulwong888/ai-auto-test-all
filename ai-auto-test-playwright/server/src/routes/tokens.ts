import { Router } from "express";
import { isAppError } from "../errors.js";
import { TokenService } from "../services/token-service.js";
import { requireProjectRole } from "../middleware/auth.js";

function projectId(req: import("express").Request): string {
  return (req.params as { id: string }).id;
}

export function createTokensRouter(): Router {
  const router = Router({ mergeParams: true });
  const tokens = new TokenService();

  router.post("/tokens", requireProjectRole("owner"), async (req, res) => {
    try {
      const name = String(req.body?.name ?? "CI Token");
      const scopes = Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : ["run"];
      const data = await tokens.createToken(projectId(req), name, scopes);
      res.status(201).json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/tokens", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const list = await tokens.listTokens(projectId(req));
      res.json({ ok: true, data: { tokens: list } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/tokens/:tokenId", requireProjectRole("owner"), async (req, res) => {
    try {
      await tokens.revokeToken(String(req.params.tokenId), projectId(req));
      res.json({ ok: true, data: { revoked: true } });
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
