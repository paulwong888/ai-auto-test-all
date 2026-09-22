import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chunk,
  componentNameFromPomFile,
  componentsWithElements,
  ensurePomCoverage,
} from "./pipeline-batch.js";
import type { ComponentRegistry } from "../artifacts/types.js";

describe("chunk", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(chunk([], 5), []);
  });

  it("splits items into batches", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5, 6, 7], 5), [
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
  });

  it("handles size 1", () => {
    assert.deepEqual(chunk(["a", "b"], 1), [["a"], ["b"]]);
  });

  it("uses minimum batch size of 1", () => {
    assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
  });
});

describe("componentNameFromPomFile", () => {
  it("strips Page suffix and extension", () => {
    assert.equal(
      componentNameFromPomFile("MaterialUITablePage.ts"),
      "MaterialUITable",
    );
  });
});

describe("componentsWithElements", () => {
  it("includes read-only page components for POM generation", () => {
    const registry: ComponentRegistry = {
      version: "2.0",
      projectId: "p",
      runId: "r",
      frontendPath: "/app",
      scannedAt: new Date().toISOString(),
      scanStats: { filesScanned: 1, componentsFound: 2, parseErrors: 0 },
      components: [
        {
          name: "DashboardPage",
          type: "react",
          filePath: "src/pages/DashboardPage.tsx",
          pageKind: "read-only",
          interactiveElements: [],
        },
        {
          name: "Provider",
          type: "react",
          filePath: "src/context/AuthProvider.tsx",
          pageKind: "provider",
          excludeFromPom: true,
          interactiveElements: [],
        },
      ],
    };

    const targets = componentsWithElements(registry);
    assert.deepEqual(targets.map((c) => c.name), ["DashboardPage"]);
  });
});

describe("ensurePomCoverage", () => {
  it("adds fallback journeys for uncovered POMs", () => {
    const journeys = ensurePomCoverage(
      [
        {
          id: "existing",
          name: "Existing",
          gherkinText: "Scenario: x\nGiven a\nWhen b\nThen c",
          steps: [
            {
              step: 1,
              action: "assert_visible",
              pom: "LoginPage",
              method: "waitForReady",
            },
          ],
        },
      ],
      ["LoginPage", "DashboardPage"],
      "http://localhost/",
    );

    assert.equal(journeys.length, 2);
    assert.ok(journeys.some((j) => j.steps.some((s) => s.pom === "DashboardPage")));
  });

  it("does not duplicate when all POMs are covered", () => {
    const journeys = ensurePomCoverage(
      [
        {
          id: "a",
          name: "A",
          gherkinText: "Scenario: x\nGiven a\nWhen b\nThen c",
          steps: [
            {
              step: 1,
              action: "assert_visible",
              pom: "LoginPage",
              method: "waitForReady",
            },
          ],
        },
      ],
      ["LoginPage"],
    );
    assert.equal(journeys.length, 1);
  });
});
