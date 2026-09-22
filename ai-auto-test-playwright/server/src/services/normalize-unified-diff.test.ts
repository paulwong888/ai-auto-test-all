import { describe, expect, it } from "vitest";
import { normalizeUnifiedDiff } from "./normalize-unified-diff.js";

describe("normalizeUnifiedDiff", () => {
  it("unwraps hunk header incorrectly prefixed with +", () => {
    const raw =
      "@@ -1,3 +1,4 @@\n line\n+AUTH=1\n+@@ -10,5 +10,6 @@\n-old\n+new\n";
    const normalized = normalizeUnifiedDiff(raw);
    expect(normalized).toContain("\n@@ -10,5 +10,6 @@\n");
    expect(normalized).not.toContain("\n+@@");
  });
});
