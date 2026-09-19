import { describe, expect, it } from "vitest";
import { parsePatchesArray } from "./fix-patch-parser.js";
import { assertSafeTestPath } from "./fix-apply-service.js";

describe("fix-patch-parser", () => {
  it("parses valid patches", () => {
    const patches = parsePatchesArray([
      { file: "tests/pages/x.py", unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n" },
    ]);
    expect(patches).toHaveLength(1);
  });

  it("blocks patch outside tests/", () => {
    expect(() => assertSafeTestPath("/ws", "../etc/passwd")).toThrow();
  });
});
