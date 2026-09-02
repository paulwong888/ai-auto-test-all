import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPiRunRpcArgs } from "./config.js";
import type { AppConfig } from "./config.js";

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "0.0.0.0",
    port: 3001,
    piCliPath: "pi",
    defaultSandboxRepo: "/app/sandbox-repos/demo-app",
    defaultTargetAppUrl: "http://localhost:8037",
    postgres: {
      host: "127.0.0.1",
      port: 5433,
      database: "test",
      user: "postgres",
      password: "postgres",
    },
    legacyProjectsFile: "/data/platform/projects.json",
    legacyAuditJobsDir: "/data/platform/audit-jobs",
    allowedRepoPrefixes: ["/app/sandbox-repos", "/data/repos"],
    sandboxReposContainerPath: "/app/sandbox-repos",
    externalReposContainerPath: "/data/repos",
    piRpcArgs: ["--no-session", "--provider", "higress"],
    piRunSkillName: "e2e-test-env",
    piRunSkillPath: "/etc/pi-agent/skills/e2e-test-env",
    auditTimeoutMs: 600_000,
    auditModuleTimeoutMs: 600_000,
    auditFullEnabled: true,
    auditProfilesDir: "/app/test-server/audit-profiles",
    runTimeoutMs: 900_000,
    runMaxPlaywrightAttempts: 3,
    runReferenceSpecLimit: 3,
    get playwrightCliPath() {
      return "/app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js";
    },
    get playwrightNodePath() {
      return "/app/sandbox-repos/demo-app/node_modules";
    },
    ...overrides,
  } as AppConfig;
}

describe("buildPiRunRpcArgs", () => {
  it("appends --skill when piRunSkillPath is set", () => {
    const args = buildPiRunRpcArgs(makeConfig());
    assert.deepEqual(args, [
      "--no-session",
      "--provider",
      "higress",
      "--skill",
      "/etc/pi-agent/skills/e2e-test-env",
    ]);
  });

  it("omits --skill when piRunSkillPath is empty", () => {
    const args = buildPiRunRpcArgs(makeConfig({ piRunSkillPath: "" }));
    assert.deepEqual(args, ["--no-session", "--provider", "higress"]);
  });
});
