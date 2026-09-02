import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BashStreamDeduper, buildRunPrompt, specRelPath } from "./run-prompt.js";
import type { AppConfig } from "../config.js";
import type { FeatureItem } from "../pi/types.js";
import type { RunPromptContext } from "./run-prompt-context.js";

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

const sampleFeature: FeatureItem = {
  id: "dashboard-stats",
  title: "Dashboard",
  description: "儀表板統計",
  route: "/dashboard",
  sourceFile: "src/pages/Dashboard.tsx",
  gherkin: {
    scenario: "顯示統計",
    given: ["已登入"],
    when: ["進入儀表板"],
    then: ["看到統計卡片"],
  },
  gherkinText: "Feature: Dashboard\n  Scenario: 顯示統計",
};

function baseCtx(overrides: Partial<RunPromptContext> = {}): RunPromptContext {
  return {
    specRelPath: specRelPath(sampleFeature.id),
    specExists: false,
    referenceSpecs: ["tests/e2e/core_case-search-case-by-params.spec.ts"],
    lastRun: null,
    ...overrides,
  };
}

describe("run-prompt", () => {
  it("specRelPath uses feature id", () => {
    assert.equal(specRelPath("dashboard-stats"), "tests/e2e/dashboard-stats.spec.ts");
  });

  it("buildRunPrompt starts with /skill:e2e-test-env", () => {
    const prompt = buildRunPrompt(
      sampleFeature,
      "/data/repos/demo",
      "http://localhost:8037",
      makeConfig(),
      baseCtx(),
    );
    assert.match(prompt, /^\/skill:e2e-test-env\n\n【Gherkin/);
    assert.match(prompt, /已加载 skill \*\*e2e-test-env\*\*/);
  });

  it("buildRunPrompt lists reference specs read-only", () => {
    const prompt = buildRunPrompt(
      sampleFeature,
      "/data/repos/demo",
      "http://localhost:8037",
      makeConfig(),
      baseCtx(),
    );
    assert.match(prompt, /执行前必读/);
    assert.match(prompt, /read tests\/e2e\/core_case-search-case-by-params\.spec\.ts.*只读/);
  });

  it("buildRunPrompt prefers edit when spec exists", () => {
    const prompt = buildRunPrompt(
      sampleFeature,
      "/data/repos/demo",
      "http://localhost:8037",
      makeConfig(),
      baseCtx({ specExists: true }),
    );
    assert.match(prompt, /优先.*edit/);
    assert.doesNotMatch(prompt, /只能\*\*建立/);
  });

  it("buildRunPrompt includes last failure summary", () => {
    const prompt = buildRunPrompt(
      sampleFeature,
      "/data/repos/demo",
      "http://localhost:8037",
      makeConfig(),
      baseCtx({
        lastRun: {
          lastSuccess: false,
          lastRunAt: "2026-01-01T00:00:00.000Z",
          playwrightAttempts: 6,
          failureSummary: "expect(getByText('x')).toBeVisible() failed",
        },
      }),
    );
    assert.match(prompt, /上次执行失败摘要/);
    assert.match(prompt, /expect\(getByText\('x'\)\)/);
  });

  it("buildRunPrompt declares playwright attempt cap", () => {
    const prompt = buildRunPrompt(
      sampleFeature,
      "/data/repos/demo",
      "http://localhost:8037",
      makeConfig({ runMaxPlaywrightAttempts: 5 }),
      baseCtx(),
    );
    assert.match(prompt, /最多执行 5 次/);
  });

  it("buildRunPrompt omits skill prefix when piRunSkillName is empty", () => {
    const prompt = buildRunPrompt(
      sampleFeature,
      "/data/repos/demo",
      "http://localhost:8037",
      makeConfig({ piRunSkillName: "" }),
      baseCtx(),
    );
    assert.match(prompt, /^【Gherkin 劇本驅動執行/);
    assert.doesNotMatch(prompt, /^\/skill:/);
  });

  it("BashStreamDeduper emits only deltas", () => {
    const d = new BashStreamDeduper();
    assert.equal(d.push("t1", "Running 3"), "Running 3");
    assert.equal(d.push("t1", "Running 3 tests"), " tests");
    assert.equal(d.push("t1", "Running 3 tests"), "");
    assert.equal(d.push("t2", "ok"), "ok");
  });
});
