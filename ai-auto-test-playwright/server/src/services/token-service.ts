import { createHash, randomBytes } from "node:crypto";
import { query } from "../db/pool.js";
import { AppError } from "../errors.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class TokenService {
  async createToken(projectId: string, name: string, scopes: string[] = ["run"]) {
    const raw = randomBytes(32).toString("hex");
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO api_tokens (id, project_id, name, token_hash, scopes) VALUES ($1,$2,$3,$4,$5)`,
      [id, projectId, name, hashToken(raw), scopes],
    );
    return { id, token: raw, scopes };
  }

  async revokeToken(tokenId: string, projectId: string): Promise<void> {
    await query(
      `UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1 AND project_id = $2`,
      [tokenId, projectId],
    );
  }

  async listTokens(projectId: string) {
    const result = await query(
      `SELECT id, name, scopes, created_at, revoked_at FROM api_tokens WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    );
    return result.rows;
  }

  async lookupToken(raw: string): Promise<{ projectId: string; scopes: string[] } | null> {
    const hash = hashToken(raw);
    const result = await query<{ project_id: string; scopes: string[] }>(
      `SELECT project_id, scopes FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { projectId: row.project_id, scopes: row.scopes };
  }

  async validateToken(raw: string, requiredScope: string): Promise<{ projectId: string; scopes: string[] }> {
    const row = await this.lookupToken(raw);
    if (!row) {
      throw new AppError("INVALID_TOKEN", "Invalid API token", 401);
    }
    if (!row.scopes.includes(requiredScope) && !row.scopes.includes("admin")) {
      throw new AppError("TOKEN_SCOPE_DENIED", `Token missing scope: ${requiredScope}`, 403);
    }
    return row;
  }

  hasScope(scopes: string[], requiredScope: string): boolean {
    return scopes.includes(requiredScope) || scopes.includes("admin");
  }
}
