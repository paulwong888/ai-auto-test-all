import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AuditMergeService } from "./audit-merge-service.js";

describe("AuditMergeService", () => {
  it("merges module partials and deduplicates by id", () => {
    const svc = new AuditMergeService();
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

    let merged = svc.mergeFeatures([], [feature], "core_case");
    assert.equal(merged.length, 1);

    merged = svc.mergeFeatures(merged, [{ ...feature, id: "search-case", title: "衝突" }, { ...feature, id: "waiving" }], "approval");
    assert.equal(merged.length, 3);
    assert.ok(merged.some((f) => f.id === "search-case"));
    assert.ok(merged.some((f) => f.id === "approval-search-case"));
    assert.ok(merged.some((f) => f.id === "waiving"));
  });
});
