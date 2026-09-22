import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ComponentEntry } from "../artifacts/types.js";
import { scriptAnalystReconcileSchema } from "../artifacts/types.js";
import {
  mergeAstWithLlm,
  validateMergePreservesAstFacts,
} from "./merge-ast-with-llm.js";

const baseAst: ComponentEntry = {
  name: "LoginPage",
  type: "react",
  filePath: "src/pages/LoginPage.tsx",
  interactiveElements: [
    {
      elementType: "button",
      role: "button",
      line: 10,
      existingTestId: "submit",
    },
  ],
  conditionalRendering: [{ condition: "error", type: "and-short-circuit" }],
};

describe("mergeAstWithLlm", () => {
  it("enriches semantics without changing AST element facts", () => {
    const merged = mergeAstWithLlm([baseAst], [
      {
        name: "LoginPage",
        filePath: "src/pages/LoginPage.tsx",
        businessSemantics: "用户登录页",
        conditionalSemanticPatches: [
          { condition: "error", semanticType: "error-state" },
        ],
        handlerPatches: [{ role: "button", handler: "onClick → submit" }],
      },
    ]);

    assert.equal(merged[0]?.businessSemantics, "用户登录页");
    assert.equal(merged[0]?.interactiveElements[0]?.line, 10);
    assert.equal(merged[0]?.interactiveElements[0]?.existingTestId, "submit");
    assert.equal(merged[0]?.conditionalRendering?.[0]?.semanticType, "error-state");
    assert.ok(validateMergePreservesAstFacts([baseAst], merged));
  });

  it("rejects merge when handlerPatches reference unknown roles", () => {
    const merged = mergeAstWithLlm([baseAst], [
      {
        name: "LoginPage",
        filePath: "src/pages/LoginPage.tsx",
        handlerPatches: [
          { role: "button", handler: "ok" },
          { role: "ghost-input", handler: "bad" },
        ],
      },
    ]);

    assert.equal(merged[0]?.businessSemantics, undefined);
    assert.equal(merged[0]?.interactiveElements.length, 1);
  });

  it("applies sparse conditionalSemanticPatches only for matching conditions", () => {
    const ast: ComponentEntry = {
      ...baseAst,
      conditionalRendering: [
        { condition: "loading", type: "and-short-circuit" },
        { condition: "error", type: "and-short-circuit" },
      ],
    };

    const merged = mergeAstWithLlm([ast], [
      {
        name: "LoginPage",
        filePath: "src/pages/LoginPage.tsx",
        conditionalSemanticPatches: [
          { condition: "loading", semanticType: "loading-state" },
        ],
      },
    ]);

    assert.equal(merged[0]?.conditionalRendering?.[0]?.semanticType, "loading-state");
    assert.equal(merged[0]?.conditionalRendering?.[1]?.semanticType, undefined);
  });
});

describe("scriptAnalystReconcileSchema", () => {
  it("parses patch-only reconcile output", () => {
    const parsed = scriptAnalystReconcileSchema.parse({
      components: [
        {
          name: "WaivingPage",
          filePath: "src/pages/WaivingPage.tsx",
          pageKind: null,
          businessSemantics: "减免申请页",
          childComponents: [{ name: "WaivingForm" }, "Table"],
          conditionalSemanticPatches: [
            { condition: "loading", semanticType: null },
          ],
          handlerPatches: [{ role: "button", handler: null }],
        },
      ],
    });

    assert.deepEqual(parsed.components[0]?.childComponents, [
      "WaivingForm",
      "Table",
    ]);
    assert.deepEqual(parsed.components[0]?.conditionalSemanticPatches, [
      { condition: "loading", semanticType: null },
    ]);
  });
});
