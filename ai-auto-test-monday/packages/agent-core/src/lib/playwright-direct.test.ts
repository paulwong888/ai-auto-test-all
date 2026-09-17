import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlaywrightCommand,
  resolvePlaywrightTestTimeoutMs,
} from "./playwright-direct.js";

describe("playwright-direct", () => {
  const prev = process.env.PLAYWRIGHT_TEST_TIMEOUT_MS;

  afterEach(() => {
    if (prev === undefined) delete process.env.PLAYWRIGHT_TEST_TIMEOUT_MS;
    else process.env.PLAYWRIGHT_TEST_TIMEOUT_MS = prev;
  });

  it("defaults per-test timeout to 50s", () => {
    delete process.env.PLAYWRIGHT_TEST_TIMEOUT_MS;
    assert.equal(resolvePlaywrightTestTimeoutMs(), 50_000);
  });

  it("includes --timeout in playwright command", () => {
    delete process.env.PLAYWRIGHT_TEST_TIMEOUT_MS;
    const cmd = buildPlaywrightCommand({
      repoPath: "/repo",
      targetUrl: "http://localhost:3000",
      specFile: "tests/e2e/login.spec.ts",
    });
    assert.match(cmd, /--timeout=50000/);
    assert.match(cmd, /tests\/e2e\/login\.spec\.ts/);
  });

  it("honors PLAYWRIGHT_TEST_TIMEOUT_MS env", () => {
    process.env.PLAYWRIGHT_TEST_TIMEOUT_MS = "45000";
    const cmd = buildPlaywrightCommand({
      repoPath: "/repo",
      targetUrl: "http://localhost:3000",
      specFile: "tests/e2e/login.spec.ts",
    });
    assert.match(cmd, /--timeout=45000/);
  });
});
