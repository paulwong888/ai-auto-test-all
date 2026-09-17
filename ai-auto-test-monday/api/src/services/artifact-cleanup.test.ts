import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFsArtifactStore } from "@monday/agent-core";
import { cleanupDownstreamArtifacts } from "./artifact-cleanup.js";

describe("cleanupDownstreamArtifacts", () => {
  let root: string;
  let prefix: string;
  let store: ReturnType<typeof createFsArtifactStore>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "artifact-cleanup-"));
    prefix = "proj/run-1";
    store = createFsArtifactStore(root);
    await store.putText(prefix, "component-registry.json", "{}");
    await store.putText(prefix, "testid-injections.json", "{}");
    await store.putText(prefix, "locator-catalog.json", "{}");
    await store.putText(prefix, "journeys.json", "{}");
    await store.putText(prefix, "execution-report.json", "{}");
    await store.putText(prefix, "poms/LoginPage.ts", "export {}");
    await store.putText(prefix, "tests/login.spec.ts", "test()");
  });

  afterEach(async () => {
    await rmSafe(root);
  });

  it("removes downstream artifacts from choreographer", async () => {
    await cleanupDownstreamArtifacts(store, prefix, "choreographer");
    const keys = await store.listRelativeKeys(prefix);
    assert.ok(keys.includes("journeys.json"));
    assert.ok(!keys.includes("execution-report.json"));
    assert.ok(!keys.some((k) => k.startsWith("tests/")));
  });

  it("removes journeys and below from setDesigner", async () => {
    await cleanupDownstreamArtifacts(store, prefix, "setDesigner");
    const keys = await store.listRelativeKeys(prefix);
    assert.ok(keys.includes("locator-catalog.json"));
    assert.ok(!keys.includes("journeys.json"));
    assert.ok(!keys.includes("execution-report.json"));
    assert.ok(!keys.some((k) => k.startsWith("poms/")));
    assert.ok(!keys.some((k) => k.startsWith("tests/")));
  });
});

async function rmSafe(dir: string): Promise<void> {
  try {
    const { rm } = await import("node:fs/promises");
    await rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
