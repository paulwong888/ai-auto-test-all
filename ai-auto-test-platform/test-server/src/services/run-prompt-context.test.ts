import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRunPromptContext } from "./run-prompt-context.js";
import { getLastFailedRun, saveRunHistoryEntry } from "./run-history-service.js";
import { InMemoryRunHistoryStore } from "../test/in-memory-stores.js";
import type { AppConfig } from "../config.js";

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
    allowedRepoPrefixes: ["/app/sandbox-repos"],
    sandboxReposContainerPath: "/app/sandbox-repos",
    externalReposContainerPath: "/data/repos",
    piRpcArgs: ["--no-session"],
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

describe("run-prompt-context", () => {
  it("prioritizes reference specs and excludes current feature", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "run-ctx-"));
    const e2e = path.join(dir, "tests/e2e");
    await fs.mkdir(e2e, { recursive: true });
    await fs.writeFile(path.join(e2e, "core_case-search-case-by-params.spec.ts"), "// a");
    await fs.writeFile(path.join(e2e, "core_case-create-case-from-search.spec.ts"), "// b");
    await fs.writeFile(path.join(e2e, "zzz-other.spec.ts"), "// c");
    await fs.writeFile(path.join(e2e, "core_case-view-incident-detail.spec.ts"), "// current");

    try {
      const ctx = await loadRunPromptContext(dir, "core_case-view-incident-detail", makeConfig());
      assert.equal(ctx.specExists, true);
      assert.deepEqual(ctx.referenceSpecs, [
        "tests/e2e/core_case-create-case-from-search.spec.ts",
        "tests/e2e/core_case-search-case-by-params.spec.ts",
        "tests/e2e/zzz-other.spec.ts",
      ]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null lastRun without projectId", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "run-ctx-"));
    await fs.mkdir(path.join(dir, "tests/e2e"), { recursive: true });
    const store = new InMemoryRunHistoryStore();
    try {
      await saveRunHistoryEntry(
        "proj-x",
        "feat-x",
        {
          lastSuccess: false,
          lastRunAt: "2026-01-02T00:00:00.000Z",
          playwrightAttempts: 4,
          failureSummary: "boom",
        },
        store,
      );
      const failed = await getLastFailedRun("proj-x", "feat-x", store);
      assert.equal(failed?.failureSummary, "boom");

      const ctx = await loadRunPromptContext(dir, "feat-x", makeConfig());
      assert.equal(ctx.lastRun, null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
