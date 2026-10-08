import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FixApplyService, isPatchAlreadyApplied } from "./fix-apply-service.js";

const OVERLAY_PATCH = `--- a/tests/pages/overlay_helpers.py
+++ b/tests/pages/overlay_helpers.py
@@ -25,11 +25,16 @@
 
 def _fill_otp_inputs(inputs: Any, code: str) -> None:
     count = inputs.count()
-    if count >= len(code):
-        for i, ch in enumerate(code):
-            inputs.nth(i).fill(ch)
-    elif count >= 1:
+    if count == 0:
+        return
+    if count == 1:
         inputs.first.fill(code)
+        return
+    for i in range(min(count, len(code))):
+        inputs.nth(i).fill(code[i])
 
 def complete_otp_if_present(page: Page) -> None:
`;

describe("isPatchAlreadyApplied", () => {
  it("detects when patch content is already present", () => {
    const source = `
def _fill_otp_inputs(inputs: Any, code: str) -> None:
    count = inputs.count()
    if count == 0:
        return
    if count == 1:
        inputs.first.fill(code)
        return
    for i in range(min(count, len(code))):
        inputs.nth(i).fill(code[i])
`;
    expect(isPatchAlreadyApplied(source, OVERLAY_PATCH)).toBe(true);
  });

  it("returns false when old lines remain", () => {
    const source = `
def _fill_otp_inputs(inputs: Any, code: str) -> None:
    count = inputs.count()
    if count >= len(code):
        for i, ch in enumerate(code):
            inputs.nth(i).fill(ch)
    elif count >= 1:
        inputs.first.fill(code)
`;
    expect(isPatchAlreadyApplied(source, OVERLAY_PATCH)).toBe(false);
  });

  it("treats patch as applied when removed lines exist only in another function", () => {
    const source = `
    def click_verify(self) -> None:
        hint = self.page.get_by_text("Please verify the mobile", exact=False)
        if hint.count() > 0 and hint.first.is_visible():
            expect(hint.first).to_be_hidden(timeout=30_000)

    def ensure_mobile_verified(self) -> None:
        """Verify 后必须离开「Please verify the mobile」提示，否则后续无法进入 SIM/Yes。

        守卫必须无条件执行：hint 在 OTP 填写/表单重渲染期间可能短暂从 DOM
        消失，旧逻辑 count==0 时直接跳过断言造成“假通过”，最终被应用
        拦截在申请表单、进不了 SIM 步。to_be_hidden 对未挂载元素直接通过，
        因此无条件等待是安全的。
        """
        self.click_verify()
        hint = self.page.get_by_text("Please verify the mobile", exact=False)
        expect(hint.first).to_be_hidden(timeout=30_000)
`;
    const kycPatch = `--- a/tests/pages/kyc_page.py
+++ b/tests/pages/kyc_page.py
@@ -68,8 +68,13 @@
             expect(hint.first).to_be_hidden(timeout=30_000)
 
     def ensure_mobile_verified(self) -> None:
-        """Verify 后必须离开「Please verify the mobile」提示，否则后续无法进入 SIM/Yes。"""
+        """Verify 后必须离开「Please verify the mobile」提示，否则后续无法进入 SIM/Yes。
+
+        守卫必须无条件执行：hint 在 OTP 填写/表单重渲染期间可能短暂从 DOM
+        消失，旧逻辑 count==0 时直接跳过断言造成“假通过”，最终被应用
+        拦截在申请表单、进不了 SIM 步。to_be_hidden 对未挂载元素直接通过，
+        因此无条件等待是安全的。
+        """
         self.click_verify()
         hint = self.page.get_by_text("Please verify the mobile", exact=False)
-        if hint.count() > 0:
-            expect(hint.first).to_be_hidden(timeout=30_000)
+        expect(hint.first).to_be_hidden(timeout=30_000)
`;
    expect(isPatchAlreadyApplied(source, kycPatch)).toBe(true);
  });
});

describe("FixApplyService", () => {
  it("skips already-applied patches instead of failing", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "fix-apply-"));
    const target = path.join(workspace, "tests/pages/overlay_helpers.py");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      `def _fill_otp_inputs(inputs: Any, code: str) -> None:
    count = inputs.count()
    if count == 0:
        return
    if count == 1:
        inputs.first.fill(code)
        return
    for i in range(min(count, len(code))):
        inputs.nth(i).fill(code[i])
`,
    );

    const service = new FixApplyService();
    const result = await service.applyPatches(workspace, [
      { file: "tests/pages/overlay_helpers.py", unifiedDiff: OVERLAY_PATCH },
    ]);

    expect(result.appliedFiles).toEqual([]);
    expect(result.skippedFiles).toEqual(["tests/pages/overlay_helpers.py"]);
  });
});
