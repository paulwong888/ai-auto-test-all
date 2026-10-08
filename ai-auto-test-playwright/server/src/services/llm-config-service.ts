import type { AppConfig } from "../config.js";
import { query } from "../db/pool.js";
import { AppError } from "../errors.js";
import type { GlobalLlmSettingsInput, ProjectLlmOverrideInput } from "../schemas/llm-settings.js";
import { decryptSecret, encryptSecret } from "../utils/credential-crypto.js";

export interface LlmSettingsPublic {
  provider: string;
  baseUrl: string;
  defaultModel: string;
  extraModels: string[];
  hasApiKey: boolean;
  updatedAt: string;
}

export interface ProjectLlmSettingsPublic extends LlmSettingsPublic {
  enabled: boolean;
  effective: LlmSettingsPublic;
}

export interface ResolvedLlmConfig {
  provider: string;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
  extraModels: string[];
}

interface GlobalRow {
  provider: string;
  base_url: string;
  default_model: string;
  encrypted_api_key: string | null;
  extra_models: string[];
  updated_at: Date;
}

interface OverrideRow {
  enabled: boolean;
  provider: string | null;
  base_url: string | null;
  default_model: string | null;
  encrypted_api_key: string | null;
  extra_models: string[] | null;
  updated_at: Date;
}

const GLOBAL_ID = "default";

export class LlmConfigService {
  constructor(private readonly config: AppConfig) {}

  async seedFromEnvIfEmpty(): Promise<void> {
    const existing = await query<{ id: string }>(
      `SELECT id FROM global_llm_settings WHERE id = $1`,
      [GLOBAL_ID],
    );
    if (existing.rowCount && existing.rowCount > 0) return;

    const envDefaults = this.envDefaults();
    await query(
      `INSERT INTO global_llm_settings (id, provider, base_url, default_model, encrypted_api_key, extra_models)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        GLOBAL_ID,
        envDefaults.provider,
        envDefaults.baseUrl,
        envDefaults.defaultModel,
        envDefaults.apiKey ? encryptSecret(envDefaults.apiKey) : null,
        JSON.stringify(envDefaults.extraModels),
      ],
    );
  }

  async getGlobal(): Promise<LlmSettingsPublic> {
    await this.seedFromEnvIfEmpty();
    const row = await this.fetchGlobalRow();
    if (!row) {
      throw new AppError("LLM_SETTINGS_NOT_FOUND", "Global LLM settings not found", 404);
    }
    return this.toPublic(row);
  }

  async updateGlobal(input: GlobalLlmSettingsInput): Promise<LlmSettingsPublic> {
    await this.seedFromEnvIfEmpty();
    const current = await this.fetchGlobalRow();
    const encrypted =
      input.apiKey && input.apiKey.trim()
        ? encryptSecret(input.apiKey.trim())
        : current?.encrypted_api_key ?? null;

    await query(
      `INSERT INTO global_llm_settings (id, provider, base_url, default_model, encrypted_api_key, extra_models, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET
         provider = EXCLUDED.provider,
         base_url = EXCLUDED.base_url,
         default_model = EXCLUDED.default_model,
         encrypted_api_key = EXCLUDED.encrypted_api_key,
         extra_models = EXCLUDED.extra_models,
         updated_at = now()`,
      [
        GLOBAL_ID,
        input.provider,
        input.baseUrl,
        input.defaultModel,
        encrypted,
        JSON.stringify(input.extraModels ?? []),
      ],
    );

    return this.getGlobal();
  }

  async getProjectOverride(projectId: string): Promise<ProjectLlmSettingsPublic> {
    const global = await this.getGlobal();
    const override = await this.fetchOverrideRow(projectId);
    const effective = override?.enabled
      ? this.mergePublic(global, override)
      : global;

    if (!override) {
      return {
        enabled: false,
        ...this.emptyDraft(global),
        effective: global,
      };
    }

    return {
      enabled: override.enabled,
      provider: override.provider ?? global.provider,
      baseUrl: override.base_url ?? global.baseUrl,
      defaultModel: override.default_model ?? global.defaultModel,
      extraModels: override.extra_models ?? global.extraModels,
      hasApiKey: Boolean(override.encrypted_api_key),
      updatedAt: override.updated_at.toISOString(),
      effective,
    };
  }

  async updateProjectOverride(
    projectId: string,
    input: ProjectLlmOverrideInput,
  ): Promise<ProjectLlmSettingsPublic> {
    const current = await this.fetchOverrideRow(projectId);
    const encrypted =
      input.apiKey && input.apiKey.trim()
        ? encryptSecret(input.apiKey.trim())
        : current?.encrypted_api_key ?? null;

    await query(
      `INSERT INTO project_llm_overrides
         (project_id, enabled, provider, base_url, default_model, encrypted_api_key, extra_models, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
       ON CONFLICT (project_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         provider = EXCLUDED.provider,
         base_url = EXCLUDED.base_url,
         default_model = EXCLUDED.default_model,
         encrypted_api_key = COALESCE(EXCLUDED.encrypted_api_key, project_llm_overrides.encrypted_api_key),
         extra_models = EXCLUDED.extra_models,
         updated_at = now()`,
      [
        projectId,
        input.enabled,
        input.provider ?? null,
        input.baseUrl ?? null,
        input.defaultModel ?? null,
        encrypted,
        JSON.stringify(input.extraModels ?? []),
      ],
    );

    return this.getProjectOverride(projectId);
  }

  async resolveForProject(projectId: string): Promise<ResolvedLlmConfig> {
    await this.seedFromEnvIfEmpty();
    const global = await this.fetchGlobalRow();
    if (!global) {
      return this.envDefaults();
    }

    const override = await this.fetchOverrideRow(projectId);
    const merged = this.mergeResolved(global, override);
    if (!merged.apiKey) {
      const env = this.envDefaults();
      merged.apiKey = env.apiKey;
    }
    return merged;
  }

  private envDefaults(): ResolvedLlmConfig {
    const extraRaw = process.env.PI_EXTRA_MODELS ?? "";
    const extraModels = extraRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((m) => m !== (process.env.PI_MODEL ?? "qwen-plus"));

    return {
      provider: this.config.pi.provider,
      baseUrl:
        process.env.LLM_BASE_URL ??
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      defaultModel: this.config.pi.model,
      apiKey: process.env.DASHSCOPE_API_KEY ?? process.env.HIGRESS_API_KEY ?? "",
      extraModels,
    };
  }

  private async fetchGlobalRow(): Promise<GlobalRow | null> {
    const result = await query<GlobalRow>(
      `SELECT provider, base_url, default_model, encrypted_api_key, extra_models, updated_at
       FROM global_llm_settings WHERE id = $1`,
      [GLOBAL_ID],
    );
    return result.rows[0] ?? null;
  }

  private async fetchOverrideRow(projectId: string): Promise<OverrideRow | null> {
    const result = await query<OverrideRow>(
      `SELECT enabled, provider, base_url, default_model, encrypted_api_key, extra_models, updated_at
       FROM project_llm_overrides WHERE project_id = $1`,
      [projectId],
    );
    return result.rows[0] ?? null;
  }

  private toPublic(row: GlobalRow): LlmSettingsPublic {
    return {
      provider: row.provider,
      baseUrl: row.base_url,
      defaultModel: row.default_model,
      extraModels: row.extra_models ?? [],
      hasApiKey: Boolean(row.encrypted_api_key),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private emptyDraft(global: LlmSettingsPublic): Omit<ProjectLlmSettingsPublic, "enabled" | "effective"> {
    return {
      provider: global.provider,
      baseUrl: global.baseUrl,
      defaultModel: global.defaultModel,
      extraModels: [],
      hasApiKey: false,
      updatedAt: global.updatedAt,
    };
  }

  private mergePublic(global: LlmSettingsPublic, override: OverrideRow): LlmSettingsPublic {
    return {
      provider: override.provider ?? global.provider,
      baseUrl: override.base_url ?? global.baseUrl,
      defaultModel: override.default_model ?? global.defaultModel,
      extraModels: override.extra_models ?? global.extraModels,
      hasApiKey: Boolean(override.encrypted_api_key ?? null),
      updatedAt: override.updated_at.toISOString(),
    };
  }

  private mergeResolved(global: GlobalRow, override: OverrideRow | null): ResolvedLlmConfig {
    const base = {
      provider: global.provider,
      baseUrl: global.base_url,
      defaultModel: global.default_model,
      apiKey: global.encrypted_api_key ? decryptSecret(global.encrypted_api_key) : "",
      extraModels: global.extra_models ?? [],
    };

    if (!override?.enabled) return base;

    return {
      provider: override.provider ?? base.provider,
      baseUrl: override.base_url ?? base.baseUrl,
      defaultModel: override.default_model ?? base.defaultModel,
      apiKey: override.encrypted_api_key
        ? decryptSecret(override.encrypted_api_key)
        : base.apiKey,
      extraModels: override.extra_models ?? base.extraModels,
    };
  }
}
