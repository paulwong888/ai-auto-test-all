import path from "node:path";
import type { AppConfig } from "../config.js";

/** Shell-safe single-quote escaping */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface PlaywrightRunnerPaths {
  cliPath: string;
  nodePath: string;
}

export function resolvePlaywrightRunnerPaths(config: AppConfig): PlaywrightRunnerPaths {
  const demoAppNodeModules = path.join(
    config.sandboxReposContainerPath,
    "demo-app/node_modules",
  );
  return {
    cliPath:
      process.env.PLAYWRIGHT_CLI_PATH ??
      path.join(demoAppNodeModules, "@playwright/test/cli.js"),
    nodePath: process.env.PLAYWRIGHT_NODE_PATH ?? demoAppNodeModules,
  };
}

/** Load .env.e2e into shell when present (Keycloak credentials). */
export function buildEnvFileSource(repoPath: string): string {
  void repoPath;
  return `[ -f .env.e2e ] && set -a && . ./.env.e2e && set +a`;
}

/**
 * Build a bash command to run Playwright against a project repo using shared container deps.
 * Does not require @playwright/test in the target repo's package.json.
 */
export function buildPlaywrightTestCommand(
  config: AppConfig,
  repoPath: string,
  targetUrl: string,
  specFile: string,
  extraArgs = "",
): string {
  const { cliPath, nodePath } = resolvePlaywrightRunnerPaths(config);
  const envSource = buildEnvFileSource(repoPath);
  const args = [`test`, `--config`, `playwright.config.ts`, specFile, extraArgs]
    .filter(Boolean)
    .join(" ");

  return [
    `cd ${shellQuote(repoPath)}`,
    envSource,
    `NODE_PATH=${shellQuote(nodePath)}`,
    `PLAYWRIGHT_BASE_URL=${shellQuote(targetUrl)}`,
    `node ${shellQuote(cliPath)} ${args}`.trim(),
  ].join(" && ");
}

/** Detect Pi/bash commands that run the target Playwright spec. */
export function isPlaywrightSpecCommand(cmd: string, specFile: string): boolean {
  if (!cmd.includes(specFile)) return false;
  return (
    cmd.includes("playwright test") ||
    cmd.includes("@playwright/test/cli.js") ||
    cmd.includes("playwright-runner")
  );
}
