import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GherkinStepTracker, applyTrackerUpdates } from "./gherkin-step-tracker.js";
import type { FlatGherkinStep } from "./types.js";

const sampleSteps: FlatGherkinStep[] = [
  { phase: "given", index: 0, text: "在登入頁", status: "pending" },
  { phase: "when", index: 0, text: "輸入帳密", status: "pending" },
  { phase: "then", index: 0, text: "看到控制台", status: "pending" },
  { phase: "then", index: 1, text: "無錯誤提示", status: "pending" },
];

describe("GherkinStepTracker", () => {
  it("marks when failed then healing on playwright error", () => {
    const tracker = new GherkinStepTracker(sampleSteps);
    tracker.onRunStart();
    tracker.onToolStart("bash", { command: "npx playwright test tests/e2e/login.spec.ts" });
    const failUpdates = tracker.onToolEnd("bash", true, {
      command: "npx playwright test tests/e2e/login.spec.ts",
    });
    const kinds = failUpdates.filter((u) => u.type === "milestone").map((u) => u.update.kind);
    assert.ok(kinds.includes("when_failed"));
    assert.ok(kinds.includes("healing_start"));
  });

  it("marks all then passed on playwright success", () => {
    const tracker = new GherkinStepTracker(sampleSteps);
    tracker.onToolStart("bash", { command: "npx playwright test tests/e2e/login.spec.ts" });
    const passUpdates = tracker.onToolEnd("bash", false, {
      command: "npx playwright test tests/e2e/login.spec.ts",
    });
    const thenPasses = passUpdates.filter(
      (u) => u.type === "milestone" && u.update.kind === "then_pass",
    );
    assert.equal(thenPasses.length, 2);
  });

  it("applyTrackerUpdates invokes callbacks", () => {
    const tracker = new GherkinStepTracker(sampleSteps);
    const steps: string[] = [];
    const milestones: string[] = [];
    applyTrackerUpdates(
      tracker.onRunStart(),
      (phase, index, status) => steps.push(`${phase}:${index}:${status}`),
      (kind, message) => milestones.push(`${kind}:${message.slice(0, 10)}`),
    );
    assert.ok(steps.length > 0);
  });

  it("getPlaywrightAttempt counts bash playwright tool_start", () => {
    const tracker = new GherkinStepTracker(sampleSteps);
    assert.equal(tracker.getPlaywrightAttempt(), 0);
    tracker.onToolStart("bash", { command: "npx playwright test tests/e2e/login.spec.ts" });
    assert.equal(tracker.getPlaywrightAttempt(), 1);
    tracker.onToolStart("bash", { command: "npx playwright test tests/e2e/login.spec.ts" });
    assert.equal(tracker.getPlaywrightAttempt(), 2);
  });
});
