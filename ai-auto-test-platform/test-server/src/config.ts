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
  /** PostgreSQL（ai-middleware/postgres，宿主机 5433） */
  postgres: {
    host: process.env.POSTGRES_HOST ?? "host.docker.internal",
    port: Number(process.env.POSTGRES_PORT ?? 5433),
    database: process.env.POSTGRES_DB ?? "ai_auto_test_platform",
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
  },
  /** @deprecated 仅用于 legacy JSON 导入 */
  legacyProjectsFile:
    process.env.PROJECTS_FILE ??
    path.resolve(rootDir, "docker/data/projects.json"),
  /** @deprecated 仅用于 legacy JSON 导入 */
  legacyAuditJobsDir:
    process.env.AUDIT_JOBS_DIR ??
    path.resolve(rootDir, "docker/data/audit-jobs"),
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
  /** 剧本执行时强制加载的 Pi skill 名称（/skill:name） */
  piRunSkillName: process.env.PI_RUN_SKILL_NAME ?? "e2e-test-env",
  /** 剧本执行时强制加载的 Pi skill 路径（空字符串=禁用） */
  piRunSkillPath:
    process.env.PI_RUN_SKILL !== undefined
      ? process.env.PI_RUN_SKILL
      : "/etc/pi-agent/skills/e2e-test-env",
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
  /** 剧本执行超时（毫秒） */
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS ?? 900_000),
  /** 单次 run 内 Playwright 针对目标 spec 的最大执行次数 */
  runMaxPlaywrightAttempts: Number(process.env.RUN_MAX_PLAYWRIGHT_ATTEMPTS ?? 3),
  /** prompt 中列出的参考 spec 数量上限 */
  runReferenceSpecLimit: Number(process.env.RUN_REFERENCE_SPEC_LIMIT ?? 3),
  /** 共享 Playwright CLI（容器内 demo-app node_modules） */
  get playwrightCliPath(): string {
    return (
      process.env.PLAYWRIGHT_CLI_PATH ??
      path.join(this.sandboxReposContainerPath, "demo-app/node_modules/@playwright/test/cli.js")
    );
  },
  get playwrightNodePath(): string {
    return (
      process.env.PLAYWRIGHT_NODE_PATH ??
      path.join(this.sandboxReposContainerPath, "demo-app/node_modules")
    );
  },
} as const;

export type AppConfig = typeof config;

/** 剧本执行专用 Pi RPC 参数（在基础参数上追加 --skill） */
export function buildPiRunRpcArgs(cfg: AppConfig): string[] {
  const args = [...cfg.piRpcArgs];
  if (cfg.piRunSkillPath) {
    args.push("--skill", cfg.piRunSkillPath);
  }
  return args;
}
