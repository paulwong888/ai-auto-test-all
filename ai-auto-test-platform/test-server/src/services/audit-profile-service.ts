import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  auditProfileSchema,
  type AuditProfile,
} from "../schemas/audit-profile.js";

export class AuditProfileService {
  constructor(private readonly config: AppConfig) {}

  async load(profileId: string): Promise<AuditProfile> {
    const filePath = path.join(this.config.auditProfilesDir, `${profileId}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    return auditProfileSchema.parse(JSON.parse(raw));
  }

  async resolveForProject(
    projectId: string,
    auditProfile?: string | null,
  ): Promise<AuditProfile | null> {
    const profileId = auditProfile ?? projectId;
    try {
      const profile = await this.load(profileId);
      if (profile.projectId !== projectId) {
        console.warn(
          `[audit-profile] profile ${profileId} projectId=${profile.projectId} does not match ${projectId}`,
        );
      }
      return profile;
    } catch {
      return null;
    }
  }
}
