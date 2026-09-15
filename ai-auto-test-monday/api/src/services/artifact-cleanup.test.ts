import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { cleanupDownstreamArtifacts } from "./artifact-cleanup.js";

describe("cleanupDownstreamArtifacts", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "artifact-cleanup-"));
    await mkdir(path.join(root, "poms"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "component-registry.json"), "{}");
    await writeFile(path.join(root, "testid-injections.json"), "{}");
    await writeFile(path.join(root, "locator-catalog.json"), "{}");
    await writeFile(path.join(root, "journeys.json"), "{}");
    await writeFile(path.join(root, "execution-report.json"), "{}");
    await writeFile(path.join(root, "poms", "LoginPage.ts"), "export {}");
    await writeFile(path.join(root, "tests", "login.spec.ts"), "test()");
  });

  afterEach(async () => {
    await rmSafe(root);
  });

  it("removes downstream artifacts from choreographer", async () => {
    await cleanupDownstreamArtifacts(root, "choreographer");
    const files = await readdir(root);
    assert.ok(files.includes("journeys.json"));
    assert.ok(!files.includes("execution-report.json"));
    assert.ok(!files.includes("tests"));
  });

  it("removes journeys and below from setDesigner", async () => {
    await cleanupDownstreamArtifacts(root, "setDesigner");
    const files = await readdir(root);
    assert.ok(files.includes("locator-catalog.json"));
    assert.ok(!files.includes("journeys.json"));
    assert.ok(!files.includes("execution-report.json"));
    assert.ok(!files.includes("poms"));
    assert.ok(!files.includes("tests"));
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
