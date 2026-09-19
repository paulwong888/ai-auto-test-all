import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { query } from "../db/pool.js";
import { AppError } from "../errors.js";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
  } catch {
    return false;
  }
}

function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET ?? "dev-jwt-secret";
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 86400000 * 7 })).toString("base64url");
  const sig = createHash("sha256").update(`${payload}.${secret}`).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): string | null {
  const secret = process.env.JWT_SECRET ?? "dev-jwt-secret";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHash("sha256").update(`${payload}.${secret}`).digest("base64url");
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    if (!data.sub || !data.exp || data.exp < Date.now()) return null;
    return data.sub;
  } catch {
    return null;
  }
}

export class AuthService {
  async register(email: string, password: string, displayName?: string): Promise<{ user: AuthUser; token: string }> {
    const existing = await query(`SELECT id FROM users WHERE email = $1`, [email.toLowerCase()]);
    if (existing.rowCount) {
      throw new AppError("EMAIL_EXISTS", "Email already registered", 409);
    }
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1,$2,$3,$4)`,
      [id, email.toLowerCase(), hashPassword(password), displayName ?? null],
    );
    const user = { id, email: email.toLowerCase(), displayName: displayName ?? null };
    return { user, token: signToken(id) };
  }

  async login(email: string, password: string): Promise<{ user: AuthUser; token: string }> {
    const result = await query<{ id: string; email: string; password_hash: string; display_name: string | null }>(
      `SELECT id, email, password_hash, display_name FROM users WHERE email = $1`,
      [email.toLowerCase()],
    );
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }
    const user = { id: row.id, email: row.email, displayName: row.display_name };
    return { user, token: signToken(row.id) };
  }

  async getUser(userId: string): Promise<AuthUser | null> {
    const result = await query<{ id: string; email: string; display_name: string | null }>(
      `SELECT id, email, display_name FROM users WHERE id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, email: row.email, displayName: row.display_name };
  }

  async getProjectRole(projectId: string, userId: string): Promise<string | null> {
    const result = await query<{ role: string }>(
      `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId],
    );
    return result.rows[0]?.role ?? null;
  }

  async ensureProjectMember(projectId: string, userId: string, role: "owner" | "editor" | "viewer"): Promise<void> {
    await query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1,$2,$3)
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [projectId, userId, role],
    );
  }
}
