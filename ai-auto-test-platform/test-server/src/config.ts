import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const sandboxReposContainerPath =
  process.env.SANDBOX_REPOS_CONTAINER_PATH ?? "/app/sandbox-repos";
const externalReposContainerPath =
  process.env.EXTERNAL_REPOS_CONTAINER_PATH ?? "/data/repos";

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3001),
  /** Pi CLI 可执行文件路径，默认 `pi` */
  piCliPath: process.env.PI_CLI_PATH ?? "pi",
  /** 默认 seed 项目源码路径 */
  defaultSandboxRepo: path.resolve(
    rootDir,
    process.env.SANDBOX_REPO ?? "sandbox-repos/demo-app",
  ),
  /** 默认 seed 项目被测 URL */
  defaultTargetAppUrl:
    process.env.TARGET_APP_URL ?? "http://host.docker.internal:8037",
  /** 项目注册表文件 */
  projectsFile:
    process.env.PROJECTS_FILE ??
    path.resolve(rootDir, "docker/data/projects.json"),
  /** 允许的源码路径前缀（容器内） */
  allowedRepoPrefixes: [
    path.resolve(
      process.env.SANDBOX_REPOS_CONTAINER_PATH
        ? sandboxReposContainerPath
        : path.join(rootDir, "sandbox-repos"),
    ),
    path.resolve(externalReposContainerPath),
  ],
  sandboxReposContainerPath: path.resolve(
    process.env.SANDBOX_REPOS_CONTAINER_PATH
      ? sandboxReposContainerPath
      : path.join(rootDir, "sandbox-repos"),
  ),
  externalReposContainerPath: path.resolve(externalReposContainerPath),
  /** Pi RPC 额外启动参数 */
  piRpcArgs: [
    ...(process.env.PI_RPC_ARGS ?? "--no-session")
      .split(/\s+/)
      .filter(Boolean),
    ...(process.env.PI_PROVIDER
      ? ["--provider", process.env.PI_PROVIDER]
      : []),
    ...(process.env.PI_MODEL ? ["--model", process.env.PI_MODEL] : []),
  ],
  /** 审计超时（毫秒） */
  auditTimeoutMs: Number(process.env.AUDIT_TIMEOUT_MS ?? 600_000),
  /** 单模块审计超时（毫秒） */
  auditModuleTimeoutMs: Number(process.env.AUDIT_MODULE_TIMEOUT_MS ?? 600_000),
  /** 是否启用完整分模块审计 */
  auditFullEnabled: process.env.AUDIT_FULL_ENABLED !== "false",
  /** 审计 profile 目录 */
  auditProfilesDir: path.resolve(
    rootDir,
    process.env.AUDIT_PROFILES_DIR ?? "test-server/audit-profiles",
  ),
  /** 审计 job 状态目录 */
  auditJobsDir:
    process.env.AUDIT_JOBS_DIR ??
    path.resolve(rootDir, "docker/data/audit-jobs"),
  /** 剧本执行超时（毫秒） */
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS ?? 900_000),
} as const;

export type AppConfig = typeof config;
