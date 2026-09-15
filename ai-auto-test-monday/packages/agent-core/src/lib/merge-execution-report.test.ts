import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExecutionReport } from "../artifacts/types.js";
import { mergeExecutionReport } from "./merge-execution-report.js";

const previous: ExecutionReport = {
  version: "1.0",
  generatedAt: "2026-09-14T00:00:00.000Z",
  executionMode: "direct",
  summary: { total: 3, passed: 1, failed: 1, skipped: 0, flaky: 1 },
  results: [
    {
      journeyId: "a",
      title: "A",
      status: "passed",
      attempts: 1,
      executionMode: "direct",
    },
    {
      journeyId: "b",
      title: "B",
      status: "failed",
      attempts: 1,
      executionMode: "direct",
    },
    {
      journeyId: "c",
      title: "C",
      status: "flaky",
      attempts: 2,
      executionMode: "direct",
    },
  ],
};

describe("mergeExecutionReport", () => {
  it("replaces selected journeys and recomputes summary", () => {
    const merged = mergeExecutionReport(
      previous,
      [
        {
          journeyId: "b",
          title: "B",
          status: "passed",
          attempts: 1,
          executionMode: "direct",
        },
        {
          journeyId: "c",
          title: "C",
          status: "passed",
          attempts: 1,
          executionMode: "direct",
        },
      ],
      ["b", "c"],
      "direct",
    );

    assert.equal(merged.summary.total, 3);
    assert.equal(merged.summary.passed, 3);
    assert.equal(merged.summary.failed, 0);
    assert.equal(merged.summary.flaky, 0);
    assert.deepEqual(
      merged.results.map((r) => [r.journeyId, r.status]),
      [
        ["a", "passed"],
        ["b", "passed"],
        ["c", "passed"],
      ],
    );
  });

  it("returns new report when no previous report exists", () => {
    const merged = mergeExecutionReport(
      null,
      [
        {
          journeyId: "x",
          title: "X",
          status: "failed",
          attempts: 1,
          executionMode: "direct",
        },
      ],
      ["x"],
      "direct",
    );
    assert.equal(merged.summary.total, 1);
    assert.equal(merged.summary.failed, 1);
  });
});
