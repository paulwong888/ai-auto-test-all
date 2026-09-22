import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  componentRegistrySchema,
  permissionModelSchema,
  routeConfigSchema,
} from "../artifacts/types.js";
import { runScriptAnalystDetailed } from "./script-analyst.js";

const demoAppPath = path.resolve(
  import.meta.dirname,
  "../../../../../ai-auto-test-platform/sandbox-repos/demo-app",
);

const savedEnv: Record<string, string | undefined> = {};

describe("runScriptAnalystDetailed integration", () => {
  before(() => {
    savedEnv.SCRIPT_ANALYST_LLM_MODE = process.env.SCRIPT_ANALYST_LLM_MODE;
    savedEnv.HIGRESS_BASE_URL = process.env.HIGRESS_BASE_URL;
    savedEnv.LLM_MAX_RETRIES = process.env.LLM_MAX_RETRIES;
    savedEnv.LLM_TIMEOUT = process.env.LLM_TIMEOUT;

    process.env.SCRIPT_ANALYST_LLM_MODE = "enrich-only";
    process.env.HIGRESS_BASE_URL = "http://127.0.0.1:1";
    process.env.LLM_MAX_RETRIES = "0";
    process.env.LLM_TIMEOUT = "1";
  });

  after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("produces valid registry, route-config, and permission-model documents", async () => {
    const result = await runScriptAnalystDetailed({
      projectId: "demo",
      runId: "test-run",
      frontendPath: demoAppPath,
    });

    assert.doesNotThrow(() => componentRegistrySchema.parse(result.registry));
    assert.doesNotThrow(() => routeConfigSchema.parse(result.routeConfig));
    assert.doesNotThrow(() => permissionModelSchema.parse(result.permissionModel));

    assert.ok(result.registry.components.length >= 3);
    assert.equal(result.routeConfig.version, "1.0");
    assert.ok(result.routeConfig.routes.some((r) => r.path === "/dashboard"));
    assert.ok(
      result.permissionModel.guards.some(
        (g) => g.route === "/dashboard" && g.guardType === "business-flow",
      ),
    );
  });
});
