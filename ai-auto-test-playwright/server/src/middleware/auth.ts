import type { Request, Response, NextFunction } from "express";
import { AuthService, verifyToken } from "../services/auth-service.js";

export interface AuthedRequest extends Request {
  userId?: string;
  projectRole?: string;
}

const authService = new AuthService();

export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "true";
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (authDisabled()) {
    next();
    return;
  }
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const userId = bearer ? verifyToken(bearer) : null;
  if (!userId) {
    res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    return;
  }
  req.userId = userId;
  next();
}

export function requireProjectRole(...roles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (authDisabled()) {
      next();
      return;
    }
    const projectId = (req.params as { id?: string }).id;
    if (!req.userId || !projectId) {
      res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
      return;
    }
    const role = await authService.getProjectRole(projectId, req.userId);
    if (!role || !roles.includes(role)) {
      res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Insufficient permissions" } });
      return;
    }
    req.projectRole = role;
    next();
  };
}

export async function requireCiToken(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (authDisabled()) {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Bearer token required" } });
    return;
  }
  req.headers["x-api-token"] = header.slice(7);
  next();
}
