import { AppError } from "../errors.js";
import { ProjectEnvRepository } from "../repositories/project-env-repository.js";
import type { ProjectEnvSettingsInput } from "../schemas/project-env.js";
import { decryptSecret, encryptSecret } from "../utils/credential-crypto.js";

export interface ProjectEnvVariablePublic {
  key: string;
  isSecret: boolean;
  hasValue: boolean;
  value?: string;
}

export interface ProjectEnvSettingsPublic {
  variables: ProjectEnvVariablePublic[];
  updatedAt: string | null;
}

export class ProjectEnvService {
  private readonly repo = new ProjectEnvRepository();

  async getSettings(projectId: string): Promise<ProjectEnvSettingsPublic> {
    const row = await this.repo.findByProjectId(projectId);
    if (!row) {
      return { variables: [], updatedAt: null };
    }
    const variables: ProjectEnvVariablePublic[] = [];
    const keys = new Set([...Object.keys(row.plain_vars), ...Object.keys(row.encrypted_vars)]);
    for (const key of [...keys].sort()) {
      if (key in row.encrypted_vars) {
        variables.push({
          key,
          isSecret: true,
          hasValue: Boolean(row.encrypted_vars[key]),
        });
      } else {
        const value = row.plain_vars[key] ?? "";
        variables.push({
          key,
          isSecret: false,
          hasValue: value.length > 0,
          value,
        });
      }
    }
    return {
      variables,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async updateSettings(projectId: string, input: ProjectEnvSettingsInput): Promise<ProjectEnvSettingsPublic> {
    const keys = input.variables.map((v) => v.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) {
      throw new AppError("DUPLICATE_ENV_KEY", `Duplicate env key: ${dup}`, 422);
    }

    const current = await this.repo.findByProjectId(projectId);
    const plainVars: Record<string, string> = {};
    const encryptedVars: Record<string, string> = {};

    for (const item of input.variables) {
      const trimmedKey = item.key.trim();
      if (item.isSecret) {
        const value = item.value?.trim() ?? "";
        if (value) {
          encryptedVars[trimmedKey] = encryptSecret(value);
        } else {
          const existing = current?.encrypted_vars[trimmedKey];
          if (existing) {
            encryptedVars[trimmedKey] = existing;
          } else {
            throw new AppError(
              "SECRET_VALUE_REQUIRED",
              `Secret variable ${trimmedKey} requires a value on first save`,
              422,
            );
          }
        }
      } else {
        plainVars[trimmedKey] = item.value ?? "";
      }
    }

    if (Object.keys(plainVars).length === 0 && Object.keys(encryptedVars).length === 0) {
      await this.repo.delete(projectId);
      return { variables: [], updatedAt: null };
    }

    await this.repo.upsert(projectId, plainVars, encryptedVars);
    return this.getSettings(projectId);
  }

  async resolveForRun(projectId: string): Promise<Record<string, string>> {
    const row = await this.repo.findByProjectId(projectId);
    if (!row) return {};

    const out: Record<string, string> = { ...row.plain_vars };
    for (const [key, encrypted] of Object.entries(row.encrypted_vars)) {
      if (!encrypted) continue;
      try {
        out[key] = decryptSecret(encrypted);
      } catch {
        console.warn(`[project-env] failed to decrypt ${key} for project ${projectId}`);
      }
    }
    return out;
  }
}
