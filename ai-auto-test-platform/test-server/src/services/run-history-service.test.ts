import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractFailureSummary,
  getLastFailedRun,
  saveRunHistoryEntry,
  truncateText,
} from "./run-history-service.js";
import { InMemoryRunHistoryStore } from "../test/in-memory-stores.js";

describe("run-history-service", () => {
  it("extractFailureSummary picks last expect failure", () => {
    const summary = extractFailureSummary([
      "Running 1 test",
      "Error: page.goto timeout",
      "expect(locator).toBeVisible() failed",
      "expect(getByText('INCIDENT')).toBeVisible() failed",
    ]);
    assert.match(summary, /INCIDENT/);
    assert.ok(summary.length <= 500);
  });

  it("truncateText truncates long strings", () => {
    assert.equal(truncateText("hello", 10), "hello");
    assert.equal(truncateText("x".repeat(20), 10).length, 10);
    assert.match(truncateText("x".repeat(20), 10), /…$/);
  });

  it("saveRunHistoryEntry persists via repository", async () => {
    const store = new InMemoryRunHistoryStore();
    await saveRunHistoryEntry("proj-1", "feat-a", {
      lastSuccess: false,
      lastRunAt: "2026-01-01T00:00:00.000Z",
      playwrightAttempts: 2,
      failureSummary: "expect failed",
    }, store);

    const entry = await getLastFailedRun("proj-1", "feat-a", store);
    assert.equal(entry?.playwrightAttempts, 2);
    assert.equal(entry?.failureSummary, "expect failed");
  });
});
