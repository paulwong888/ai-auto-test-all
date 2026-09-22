export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  /** Max idle time between stream chunks (ms). */
  streamChunkTimeoutMs: number;
  /** Use SSE streaming for chat/completions (default true). */
  streamEnabled: boolean;
  /** Reasoning effort for thinking models (e.g. "low" | "medium"). Omit to use server default. */
  reasoningEffort?: string;
}

function loadStreamOptionsFromEnv(env: NodeJS.ProcessEnv): {
  streamChunkTimeoutMs: number;
  streamEnabled: boolean;
} {
  const streamEnabledRaw = env.LLM_STREAM_ENABLED ?? "true";
  return {
    streamChunkTimeoutMs:
      Number(env.LLM_STREAM_CHUNK_TIMEOUT ?? 600) * 1000,
    streamEnabled: !/^(0|false|no)$/i.test(streamEnabledRaw),
  };
}

export function loadLlmConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  return {
    baseUrl: env.HIGRESS_BASE_URL ?? "http://localhost:8004/v1",
    apiKey: env.HIGRESS_API_KEY ?? "not-needed",
    model: env.LLM_MODEL ?? "ds-v4-flash-0731-dspark",
    timeoutMs: Number(env.LLM_TIMEOUT ?? 900) * 1000,
    maxRetries: Number(env.LLM_MAX_RETRIES ?? 2),
    reasoningEffort: env.LLM_REASONING_EFFORT?.trim() || undefined,
    ...loadStreamOptionsFromEnv(env),
  };
}

function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null || value.trim() === "") return defaultValue;
  return !/^(0|false|no)$/i.test(value.trim());
}

export interface ScanConfig {
  maxFiles: number;
  maxComponents: number;
  includeReadOnlyPages: boolean;
}

export function loadScanConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ScanConfig {
  return {
    maxFiles: Number(env.SCAN_MAX_FILES ?? 300),
    maxComponents: Number(env.SCAN_MAX_COMPONENTS ?? 80),
    includeReadOnlyPages: parseBoolEnv(env.SCAN_INCLUDE_READ_ONLY_PAGES, true),
  };
}

export interface RouteScanConfig {
  maxFiles: number;
}

export function loadRouteScanConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RouteScanConfig {
  return {
    maxFiles: Number(env.ROUTE_SCAN_MAX_FILES ?? 5000),
  };
}

export type ScriptAnalystLlmMode = "reconcile" | "enrich-only";

export interface ScriptAnalystConfig {
  llmMode: ScriptAnalystLlmMode;
  batchFiles: number;
  maxChars: number;
  batchWeightLimit: number;
  soloConditionalThreshold: number;
}

export function loadScriptAnalystConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ScriptAnalystConfig {
  const modeRaw = (env.SCRIPT_ANALYST_LLM_MODE ?? "reconcile").trim();
  const llmMode: ScriptAnalystLlmMode =
    modeRaw === "enrich-only" ? "enrich-only" : "reconcile";
  return {
    llmMode,
    batchFiles: Math.max(1, Number(env.SCRIPT_ANALYST_BATCH_FILES ?? 8)),
    maxChars: Math.max(10_000, Number(env.SCRIPT_ANALYST_MAX_CHARS ?? 180_000)),
    batchWeightLimit: Math.max(
      1,
      Number(env.SCRIPT_ANALYST_BATCH_WEIGHT_LIMIT ?? 8),
    ),
    soloConditionalThreshold: Math.max(
      1,
      Number(env.SCRIPT_ANALYST_SOLO_CONDITIONAL_THRESHOLD ?? 40),
    ),
  };
}

/** Optional longer timeout for Script Analyst reconcile batches. */
export function loadScriptAnalystLlmConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  const base = loadLlmConfigFromEnv(env);
  const timeoutSec = Number(
    env.SCRIPT_ANALYST_LLM_TIMEOUT ?? env.LLM_TIMEOUT ?? 1800,
  );
  const streamChunkTimeoutSec = Number(
    env.SCRIPT_ANALYST_LLM_STREAM_CHUNK_TIMEOUT ??
      env.SCRIPT_ANALYST_LLM_TIMEOUT ??
      env.LLM_STREAM_CHUNK_TIMEOUT ??
      timeoutSec,
  );
  return {
    ...base,
    timeoutMs: timeoutSec * 1000,
    streamChunkTimeoutMs: streamChunkTimeoutSec * 1000,
    maxRetries: Number(env.SCRIPT_ANALYST_LLM_MAX_RETRIES ?? env.LLM_MAX_RETRIES ?? 2),
  };
}

export interface JourneyConfig {
  min: number;
  max: number;
}

export function loadJourneyConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): JourneyConfig {
  return {
    min: Number(env.JOURNEY_MIN ?? 5),
    max: Number(env.JOURNEY_MAX ?? 8),
  };
}

export interface PipelineScaleConfig {
  pomBatchSize: number;
  choreographerBatchSize: number;
  fullCoverage: boolean;
}

export function loadPipelineScaleConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): PipelineScaleConfig {
  return {
    pomBatchSize: Math.max(1, Number(env.POM_BATCH_SIZE ?? 5)),
    choreographerBatchSize: Math.max(
      1,
      Number(env.CHOREOGRAPHER_BATCH_SIZE ?? 8),
    ),
    fullCoverage: parseBoolEnv(env.FULL_COVERAGE, true),
  };
}

/** Shorter timeout for Choreographer so pipeline does not appear stuck. */
export function loadChoreographerLlmConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  const base = loadLlmConfigFromEnv(env);
  const choreoTimeoutSec = Number(env.CHOREOGRAPHER_LLM_TIMEOUT ?? 600);
  return {
    ...base,
    timeoutMs: choreoTimeoutSec * 1000,
    maxRetries: Number(env.CHOREOGRAPHER_LLM_MAX_RETRIES ?? 1),
  };
}
