import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createFsArtifactStore } from "./fs-store.js";
import { pullToLocal, pushFromLocal } from "./staging.js";

describe("fs artifact store", () => {
  let base: string;
  let store: ReturnType<typeof createFsArtifactStore>;
  const prefix = "demo/run-1";

  beforeEach(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "fs-store-"));
    store = createFsArtifactStore(base);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("put/get/list/delete", async () => {
    await store.putText(prefix, "journeys.json", '{"journeys":[]}');
    await store.putText(prefix, "poms/Login.ts", "export class Login {}");

    assert.equal(await store.getText(prefix, "journeys.json"), '{"journeys":[]}');
    const keys = await store.listRelativeKeys(prefix);
    assert.ok(keys.includes("journeys.json"));
    assert.ok(keys.includes("poms/Login.ts"));

    await store.deletePrefix(prefix, "poms");
    const after = await store.listRelativeKeys(prefix);
    assert.ok(!after.some((k) => k.startsWith("poms/")));
  });

  it("staging pull and push", async () => {
    await store.putText(prefix, "journeys.json", "original");
    const staging = await mkdtemp(path.join(os.tmpdir(), "stage-"));
    try {
      await pullToLocal(store, prefix, staging);
      await writeFile(path.join(staging, "journeys.json"), "mutated-local", "utf8");
      await pushFromLocal(store, prefix, staging);
      assert.equal(await store.getText(prefix, "journeys.json"), "mutated-local");
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  });
});
