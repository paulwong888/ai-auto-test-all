import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ComponentEntry } from "../artifacts/types.js";
import {
  filterRegistryComponents,
  isPageComponent,
} from "./script-analyst-filter.js";

describe("script-analyst-filter", () => {
  it("keeps read-only page components when enabled", () => {
    const components: ComponentEntry[] = [
      {
        name: "DashboardPage",
        type: "react",
        filePath: "src/pages/DashboardPage.tsx",
        interactiveElements: [],
      },
      {
        name: "Helper",
        type: "react",
        filePath: "src/components/Helper.tsx",
        interactiveElements: [],
      },
    ];

    const filtered = filterRegistryComponents(components, {
      maxFiles: 300,
      maxComponents: 80,
      includeReadOnlyPages: true,
    });

    assert.ok(filtered.some((c) => c.name === "DashboardPage"));
    assert.ok(!filtered.some((c) => c.name === "Helper"));
    assert.equal(filtered.find((c) => c.name === "DashboardPage")?.pageKind, "read-only");
  });

  it("detects page components by path or name", () => {
    assert.ok(
      isPageComponent({
        name: "HomePage",
        type: "react",
        filePath: "src/pages/HomePage.tsx",
        interactiveElements: [],
      }),
    );
  });
});
