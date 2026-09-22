import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

function parsePrefixes(raw: string | undefined, fallback: string): string[] {
  const value = raw ?? fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3001),
  postgres: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "ai_auto_test_playwright",
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
  },
  projectsDataPath: path.resolve(
    process.env.PROJECTS_DATA_PATH ?? path.join(rootDir, "data/projects"),
  ),
  allowedRepoPrefixes: parsePrefixes(
    process.env.ALLOWED_REPO_PREFIXES,
    path.join(rootDir, "data/projects"),
  ),
  workerUrl: process.env.WORKER_URL ?? "http://worker:8081",
  workerVncHost: process.env.WORKER_VNC_HOST ?? "worker",
  workerVncPort: Number(process.env.WORKER_VNC_PORT ?? 6080),
  pi: {
    cliPath: process.env.PI_CLI_PATH ?? "pi",
    rpcArgs: (process.env.PI_RPC_ARGS ?? "--no-session").split(/\s+/).filter(Boolean),
    provider: process.env.PI_PROVIDER ?? "dashscope",
    model: process.env.PI_MODEL ?? "qwen-plus",
    runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS ?? 600_000),
  },
};

export type AppConfig = typeof config;
