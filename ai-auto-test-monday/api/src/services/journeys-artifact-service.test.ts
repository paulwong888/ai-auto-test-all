import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ARTIFACT_FILE_MAP } from "./journeys-artifact-service.js";

const SCRIPT_ANALYST_ARTIFACT_KEYS = [
  "registry",
  "route-config",
  "permission-model",
] as const;

describe("ARTIFACT_FILE_MAP scriptAnalyst artifacts", () => {
  for (const key of SCRIPT_ANALYST_ARTIFACT_KEYS) {
    it(`maps ${key} to a json file`, () => {
      const rel = ARTIFACT_FILE_MAP[key];
      assert.ok(rel, `missing map entry for ${key}`);
      assert.match(rel, /\.json$/);
    });
  }
});
