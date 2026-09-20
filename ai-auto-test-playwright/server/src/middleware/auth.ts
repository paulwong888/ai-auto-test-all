import type { Request, Response, NextFunction } from "express";
import { AuthService, verifyToken } from "../services/auth-service.js";
import { TokenService } from "../services/token-service.js";

export interface AuthedRequest extends Request {
  userId?: string;
  projectRole?: string;
  apiTokenProjectId?: string;
  apiTokenScopes?: string[];
}

const authService = new AuthService();
const tokenService = new TokenService();

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "true";
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const bearer = bearerToken(req);
  if (bearer) {
    const userId = verifyToken(bearer);
    if (userId) {
      req.userId = userId;
      next();
      return;
    }
    const apiToken = await tokenService.lookupToken(bearer);
    if (apiToken) {
      req.apiTokenProjectId = apiToken.projectId;
      req.apiTokenScopes = apiToken.scopes;
      next();
      return;
    }
  }

  if (authDisabled()) {
    next();
    return;
  }

  res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
}

export function rejectApiTokenUnlessScope(...allowedScopes: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const bearer = bearerToken(req);
    if (!bearer) {
      next();
      return;
    }
    if (verifyToken(bearer)) {
      next();
      return;
    }

    const apiToken = await tokenService.lookupToken(bearer);
    if (!apiToken) {
      next();
      return;
    }

    req.apiTokenProjectId = apiToken.projectId;
    req.apiTokenScopes = apiToken.scopes;
    const allowed = allowedScopes.some((scope) => tokenService.hasScope(apiToken.scopes, scope));
    if (!allowed) {
      res.status(403).json({
        ok: false,
        error: { code: "TOKEN_SCOPE_DENIED", message: `Token missing scope: ${allowedScopes.join(" or ")}` },
      });
      return;
    }
    next();
  };
}

export function assertApiTokenProject(req: AuthedRequest, projectId: string, res: Response): boolean {
  if (!req.apiTokenProjectId) return true;
  if (req.apiTokenProjectId !== projectId) {
    res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Token not scoped to project" },
    });
    return false;
  }
  if (!tokenService.hasScope(req.apiTokenScopes ?? [], "run")) {
    res.status(403).json({
      ok: false,
      error: { code: "TOKEN_SCOPE_DENIED", message: "Token missing scope: run" },
    });
    return false;
  }
  return true;
}

export function requireProjectMember() {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.apiTokenProjectId) {
      const projectId = (req.params as { id?: string }).id;
      if (projectId && req.apiTokenProjectId !== projectId) {
        res.status(403).json({
          ok: false,
          error: { code: "FORBIDDEN", message: "Token not scoped to project" },
        });
        return;
      }
      next();
      return;
    }
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
    if (!role) {
      res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Not a project member" } });
      return;
    }
    req.projectRole = role;
    next();
  };
}

export function requireProjectRole(...roles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.apiTokenProjectId) {
      res.status(403).json({
        ok: false,
        error: { code: "TOKEN_SCOPE_DENIED", message: "API token cannot access this route" },
      });
      return;
    }
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
