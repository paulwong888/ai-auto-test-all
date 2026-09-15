import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface DirectRunOptions {
  repoPath: string;
  targetUrl: string;
  specFile: string;
  playwrightCliPath?: string;
  nodePath?: string;
  timeoutMs?: number;
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

  return [
    `cd ${shellQuote(opts.repoPath)}`,
    `{ [ -f .env.e2e ] && set -a && . ./.env.e2e && set +a; true; }`,
    `NODE_PATH=${shellQuote(resolvedNode)}`,
    `PLAYWRIGHT_BASE_URL=${shellQuote(opts.targetUrl)}`,
    `node ${shellQuote(resolvedCli)} test --config playwright.config.ts ${opts.specFile}`,
  ].join(" && ");
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
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", cmd], {
      timeout: opts.timeoutMs ?? 600_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      success: true,
      stdout,
      stderr,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      durationMs: Date.now() - start,
    };
  }
}
