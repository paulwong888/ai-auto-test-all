export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export function loadLlmConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig {
  return {
    baseUrl: env.HIGRESS_BASE_URL ?? "http://localhost:8004/v1",
    apiKey: env.HIGRESS_API_KEY ?? "not-needed",
    model: env.LLM_MODEL ?? "ds-v4-flash-0731-dspark",
    timeoutMs: Number(env.LLM_TIMEOUT ?? 600) * 1000,
    maxRetries: Number(env.LLM_MAX_RETRIES ?? 2),
  };
}

export interface ScanConfig {
  maxFiles: number;
  maxComponents: number;
}

export function loadScanConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ScanConfig {
  return {
    maxFiles: Number(env.SCAN_MAX_FILES ?? 300),
    maxComponents: Number(env.SCAN_MAX_COMPONENTS ?? 80),
  };
}
