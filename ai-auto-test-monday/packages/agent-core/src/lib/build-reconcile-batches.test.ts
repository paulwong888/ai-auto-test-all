import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ComponentEntry } from "../artifacts/types.js";
import {
  buildReconcileBatches,
  componentReconcileWeight,
  mustSoloReconcileBatch,
} from "./build-reconcile-batches.js";

function makeComponent(
  name: string,
  conditionalCount: number,
): ComponentEntry {
  return {
    name,
    type: "react",
    filePath: `src/${name}.jsx`,
    interactiveElements: [],
    conditionalRendering: Array.from({ length: conditionalCount }, (_, i) => ({
      condition: `${name}-cond-${i}`,
    })),
  };
}

describe("buildReconcileBatches", () => {
  it("puts high conditionalRendering components in solo batches", () => {
    const heavy = makeComponent("TaskDetailReadOnly", 54);
    const light = makeComponent("WaivingPage", 0);
    const sources = new Map([
      [heavy.filePath, "x".repeat(1000)],
      [light.filePath, "y".repeat(1000)],
    ]);

    const batches = buildReconcileBatches([light, heavy, light], sources, {
      batchFiles: 8,
      maxChars: 180_000,
      batchWeightLimit: 8,
      soloConditionalThreshold: 20,
    });

    assert.equal(batches.length, 3);
    assert.deepEqual(
      batches.map((batch) => batch.map((entry) => entry.ast.name)),
      [["WaivingPage"], ["TaskDetailReadOnly"], ["WaivingPage"]],
    );
  });

  it("weights conditional-heavy components into smaller groups", () => {
    const a = makeComponent("A", 12);
    const b = makeComponent("B", 12);
    const sources = new Map([
      [a.filePath, "a"],
      [b.filePath, "b"],
    ]);

    assert.equal(componentReconcileWeight(a), 2);
    assert.ok(mustSoloReconcileBatch(makeComponent("Solo", 20), 20));

    const batches = buildReconcileBatches([a, b], sources, {
      batchFiles: 8,
      maxChars: 180_000,
      batchWeightLimit: 3,
      soloConditionalThreshold: 20,
    });

    assert.equal(batches.length, 2);
    assert.equal(batches[0]?.length, 1);
    assert.equal(batches[1]?.length, 1);
  });
});
