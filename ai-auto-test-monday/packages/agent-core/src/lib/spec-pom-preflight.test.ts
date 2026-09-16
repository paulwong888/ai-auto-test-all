import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findSpecPomMethodMismatches,
  journeyNeedsUnauthenticatedContext,
  parseSpecPomCalls,
  resolvePomClassFromVarName,
} from "./spec-pom-preflight.js";

describe("spec-pom-preflight", () => {
  it("parses page method calls from spec content", () => {
    const calls = parseSpecPomCalls(`
      await holdSuspensionPage.selectHoldSuspensionOption('reason');
      await holdSuspensionPage.assertHoldSuspensionFormVisible();
    `);
    assert.deepEqual(calls, [
      { varName: "holdSuspensionPage", method: "selectHoldSuspensionOption" },
      { varName: "holdSuspensionPage", method: "assertHoldSuspensionFormVisible" },
    ]);
  });

  it("resolves camelCase variable names to POM classes", () => {
    const classes = ["HoldSuspensionPage", "LoginPage"];
    assert.equal(
      resolvePomClassFromVarName("holdSuspensionPage", classes),
      "HoldSuspensionPage",
    );
  });

  it("detects missing POM methods referenced by spec", () => {
    const pomMethods = new Map<string, Set<string>>([
      ["HoldSuspensionPage", new Set(["selectHoldSuspensionOption"])],
    ]);
    const spec = `
      await holdSuspensionPage.selectSuspensionReason('x');
      await holdSuspensionPage.selectHoldSuspensionOption('y');
    `;
    const mismatches = findSpecPomMethodMismatches(spec, pomMethods);
    assert.deepEqual(mismatches, [
      "HoldSuspensionPage.selectSuspensionReason (via holdSuspensionPage.selectSuspensionReason)",
    ]);
  });

  it("flags journeys that need unauthenticated Playwright context", () => {
    assert.equal(
      journeyNeedsUnauthenticatedContext({
        category: "Happy Path",
        steps: [{ method: "assertRedirectToLogin", action: "assert_state" }],
      }),
      true,
    );
    assert.equal(
      journeyNeedsUnauthenticatedContext({
        category: "Permission Boundary",
        steps: [
          {
            method: "assertUnauthenticatedRedirect",
            action: "assert_state",
            description: "redirect to login without credentials",
          },
        ],
      }),
      true,
    );
    assert.equal(
      journeyNeedsUnauthenticatedContext({
        category: "Happy Path",
        steps: [{ method: "clickSubmit", action: "interact" }],
      }),
      false,
    );
  });
});
