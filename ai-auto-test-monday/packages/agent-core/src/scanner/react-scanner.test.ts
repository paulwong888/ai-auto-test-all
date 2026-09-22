import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { scanReactProject } from "./react-scanner.js";
import { filterRegistryComponents } from "../lib/script-analyst-filter.js";

const demoAppPath = path.resolve(
  import.meta.dirname,
  "../../../../../ai-auto-test-platform/sandbox-repos/demo-app",
);

describe("scanReactProject demo-app", () => {
  it("includes LoginPage, HomePage, and DashboardPage with AST facts", async () => {
    const scan = await scanReactProject(demoAppPath, {
      maxFiles: 300,
      maxComponents: 80,
      includeReadOnlyPages: true,
    });

    const components = filterRegistryComponents(scan.components, {
      maxFiles: 300,
      maxComponents: 80,
      includeReadOnlyPages: true,
    });

    const names = components.map((c) => c.name).sort();
    assert.ok(names.includes("LoginPage"));
    assert.ok(names.includes("HomePage"));
    assert.ok(names.includes("DashboardPage"));

    const login = components.find((c) => c.name === "LoginPage");
    assert.ok(login);
    assert.ok((login?.interactiveElements.length ?? 0) >= 3);
    assert.ok((login?.conditionalRendering?.length ?? 0) >= 1);
    assert.ok((login?.state?.length ?? 0) >= 1);
  });
});
