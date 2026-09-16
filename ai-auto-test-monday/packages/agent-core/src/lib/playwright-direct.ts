import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface DirectRunOptions {
  repoPath: string;
  targetUrl: string;
  specFile: string;
  e2eEnv?: Record<string, string>;
  playwrightCliPath?: string;
  nodePath?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface DirectRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export function resolvePlaywrightPaths(repoPath: string): {
  cliPath: string;
  nodePath: string;
} {
  const fromRepo = path.join(
    repoPath,
    "node_modules/@playwright/test/cli.js",
  );
  const sandboxDemo = "/data/repos/sandbox/demo-app/node_modules/@playwright/test/cli.js";
  const platformDemo =
    "/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js";

  const cliPath = envOrDefault(
    "PLAYWRIGHT_CLI_PATH",
    fromRepo,
  );
  const nodePath = envOrDefault(
    "PLAYWRIGHT_NODE_PATH",
    path.dirname(path.dirname(cliPath)),
  );

  // Prefer repo-local deps; fall back to shared demo-app node_modules.
  const candidates = [cliPath, fromRepo, sandboxDemo, platformDemo];
  const resolvedCli = candidates.find((p) => p.length > 0) ?? sandboxDemo;

  const nodeModulesDir = resolvedCli.includes("node_modules")
    ? resolvedCli.split("node_modules")[0]! + "node_modules"
    : path.join(repoPath, "node_modules");

  return {
    cliPath: resolvedCli,
    nodePath: nodeModulesDir,
  };
}

export function buildPlaywrightCommand(opts: DirectRunOptions): string {
  const { cliPath, nodePath } = resolvePlaywrightPaths(opts.repoPath);
  const resolvedCli = opts.playwrightCliPath?.trim() || cliPath;
  const resolvedNode = opts.nodePath?.trim() || nodePath;

  const parts = [
    `cd ${shellQuote(opts.repoPath)}`,
    `{ [ -f .env.e2e ] && set -a && . ./.env.e2e && set +a; true; }`,
  ];

  if (opts.e2eEnv) {
    for (const [key, value] of Object.entries(opts.e2eEnv)) {
      parts.push(`export ${key}=${shellQuote(value)}`);
    }
  }

  // Env vars must prefix `node` (not `VAR=... && node`): unexported assignments
  // are not inherited by child processes, breaking @playwright/test resolution
  // when playwright.config.ts loads from a repo with a broken node_modules symlink.
  parts.push(
    `NODE_PATH=${shellQuote(resolvedNode)} PLAYWRIGHT_BASE_URL=${shellQuote(opts.targetUrl)} node ${shellQuote(resolvedCli)} test --config playwright.config.ts ${opts.specFile}`,
  );

  return parts.join(" && ");
}


export async function ensurePlaywrightBrowsers(repoPath: string): Promise<void> {
  const { cliPath } = resolvePlaywrightPaths(repoPath);
  const installCmd = [
    `node ${shellQuote(cliPath)} install-deps chromium 2>/dev/null || true`,
    `node ${shellQuote(cliPath)} install chromium`,
  ].join(" && ");
  try {
    await execFileAsync("bash", ["-lc", installCmd], {
      timeout: 300_000,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(
      `Playwright browsers not ready for direct execution: ${e.stderr ?? e.message ?? String(err)}`,
    );
  }
}

export async function runPlaywrightSpec(
  opts: DirectRunOptions,
): Promise<DirectRunResult> {
  const start = Date.now();
  const cmd = buildPlaywrightCommand(opts);
  const timeoutMs = opts.timeoutMs ?? 600_000;

  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000);
    };
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code) => {
      clearTimeout(timeout);
      opts.abortSignal?.removeEventListener("abort", onAbort);
      const cancelled = opts.abortSignal?.aborted;
      resolve({
        success: !cancelled && code === 0,
        stdout,
        stderr: cancelled ? stderr || "Activity cancelled" : stderr,
        durationMs: Date.now() - start,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      opts.abortSignal?.removeEventListener("abort", onAbort);
      resolve({
        success: false,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}
