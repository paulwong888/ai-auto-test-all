import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRunActivelyRunning } from "./pipeline-service.js";

describe("isRunActivelyRunning", () => {
  it("treats generation running as active", () => {
    assert.equal(isRunActivelyRunning({ status: "running", execution_status: "pending" }), true);
  });

  it("treats execute-only running as active", () => {
    assert.equal(isRunActivelyRunning({ status: "completed", execution_status: "running" }), true);
  });

  it("does not treat cancelled run with stale execution_status as active", () => {
    assert.equal(isRunActivelyRunning({ status: "cancelled", execution_status: "running" }), false);
  });

  it("does not treat failed run with stale execution_status as active", () => {
    assert.equal(isRunActivelyRunning({ status: "failed", execution_status: "running" }), false);
  });

  it("does not treat finished run as active", () => {
    assert.equal(isRunActivelyRunning({ status: "completed", execution_status: "completed" }), false);
  });
});
