import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { AuditMergeService } from "./audit-merge-service.js";

describe("AuditMergeService", () => {
  it("merges module partials and deduplicates by id", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "audit-merge-"));
    const svc = new AuditMergeService();
    await svc.ensurePiAuditDir(tmp);

    const feature = {
      id: "search-case",
      title: "搜尋案件",
      description: "desc",
      sourceFile: "src/App.js",
      route: "/SearchPage",
      gherkin: {
        scenario: "搜尋",
        given: ["已登入"],
        when: ["輸入關鍵字"],
        then: ["顯示結果"],
      },
      gherkinText: "Scenario: 搜尋\n  Given 已登入\n  When 輸入關鍵字\n  Then 顯示結果",
    };

    await fs.writeFile(
      path.join(tmp, ".pi-audit", "core_case.json"),
      JSON.stringify({
        moduleId: "core_case",
        features: [{ ...feature, gherkin: undefined, sourceFile: undefined }],
      }),
    );
    await fs.writeFile(
      path.join(tmp, ".pi-audit", "approval.json"),
      JSON.stringify({
        moduleId: "approval",
        features: [{ ...feature, id: "search-case", title: "衝突" }, { ...feature, id: "waiving" }],
      }),
    );

    const merged = await svc.mergeAllPartials(tmp, ["core_case", "approval"]);
    assert.equal(merged.length, 3);
    assert.ok(merged.some((f) => f.id === "search-case"));
    assert.ok(merged.some((f) => f.id === "approval-search-case"));
    assert.ok(merged.some((f) => f.id === "waiving"));

    const doc = await svc.writeFeaturesDocument(tmp, merged);
    assert.equal(doc.features.length, 3);
    const onDisk = JSON.parse(await fs.readFile(path.join(tmp, "FEATURES.json"), "utf8"));
    assert.equal(onDisk.features.length, 3);
  });
});
