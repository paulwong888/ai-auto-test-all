import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BashStreamDeduper, specRelPath } from "./run-prompt.js";

describe("run-prompt", () => {
  it("specRelPath uses feature id", () => {
    assert.equal(specRelPath("dashboard-stats"), "tests/e2e/dashboard-stats.spec.ts");
  });

  it("BashStreamDeduper emits only deltas", () => {
    const d = new BashStreamDeduper();
    assert.equal(d.push("t1", "Running 3"), "Running 3");
    assert.equal(d.push("t1", "Running 3 tests"), " tests");
    assert.equal(d.push("t1", "Running 3 tests"), "");
    assert.equal(d.push("t2", "ok"), "ok");
  });
});
