import { randomUUID } from "node:crypto";
import { query } from "../db/pool.js";

export class AuditService {
  async log(input: {
    projectId?: string | null;
    userId?: string | null;
    action: string;
    resource?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await query(
      `INSERT INTO audit_logs (id, project_id, user_id, action, resource, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        input.projectId ?? null,
        input.userId ?? null,
        input.action,
        input.resource ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async listByProject(projectId: string, limit = 50) {
    const result = await query(
      `SELECT id, project_id, user_id, action, resource, metadata, created_at
       FROM audit_logs WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [projectId, limit],
    );
    return result.rows;
  }
}
