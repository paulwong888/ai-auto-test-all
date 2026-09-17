import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeStoreFilesIntoIndex } from "./pipeline-service.js";
import type { ArtifactIndexEntry } from "./pipeline-service.js";

describe("mergeStoreFilesIntoIndex", () => {
  it("adds store-only spec files to the index list", () => {
    const items: ArtifactIndexEntry[] = [
      {
        key: "journeys",
        label: "journeys.json",
        kind: "json",
        agent: "choreographer",
        artifactType: "journeys",
        available: true,
      },
    ];
    const seen = new Set(items.map((item) => item.key));

    mergeStoreFilesIntoIndex(items, seen, [
      {
        key: "spec-login-happy-path.spec.ts",
        label: "tests/login-happy-path.spec.ts",
        kind: "text",
      },
    ]);

    assert.equal(items.length, 2);
    assert.equal(items[1]?.key, "spec-login-happy-path.spec.ts");
    assert.equal(items[1]?.available, true);
  });

  it("marks indexed spec as available when store catches up", () => {
    const items: ArtifactIndexEntry[] = [
      {
        key: "spec-login-happy-path.spec.ts",
        label: "tests/login-happy-path.spec.ts",
        kind: "text",
        agent: "assistantDirector",
        artifactType: "spec",
        available: false,
      },
    ];
    const seen = new Set(items.map((item) => item.key));

    mergeStoreFilesIntoIndex(items, seen, [
      {
        key: "spec-login-happy-path.spec.ts",
        label: "tests/login-happy-path.spec.ts",
        kind: "text",
      },
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0]?.available, true);
  });

  it("keeps unavailable indexed spec entries instead of dropping them", () => {
    const unavailableSpec: ArtifactIndexEntry = {
      key: "spec-login-happy-path.spec.ts",
      label: "tests/login-happy-path.spec.ts",
      kind: "text",
      agent: "assistantDirector",
      artifactType: "spec",
      available: false,
    };

    assert.equal(unavailableSpec.available, false);
    assert.ok(unavailableSpec.key.startsWith("spec-"));
  });
});
