import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import {
  journeyGenerationFromLlmSchema,
  pomGenerationSchema,
  scriptAnalystEnhancementSchema,
  scriptAnalystReconcileSchema,
  specGenerationSchema,
} from "../artifacts/types.js";

const LLM_SCHEMAS: Array<{ name: string; schema: ZodType<unknown> }> = [
  { name: "script_analyst_reconcile", schema: scriptAnalystReconcileSchema },
  { name: "script_analyst_enhancement", schema: scriptAnalystEnhancementSchema },
  { name: "journey_generation", schema: journeyGenerationFromLlmSchema },
  { name: "pom_generation", schema: pomGenerationSchema },
  { name: "spec_generation", schema: specGenerationSchema },
];

function zodResponseFormatWarnings(schema: ZodType<unknown>, name: string): string[] {
  const warns: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };
  try {
    zodResponseFormat(schema, name);
  } finally {
    console.warn = originalWarn;
  }
  return warns;
}

describe("LLM schemas for zodResponseFormat", () => {
  for (const { name, schema } of LLM_SCHEMAS) {
    it(`${name} produces no OpenAI optional/nullable warnings`, () => {
      const warns = zodResponseFormatWarnings(schema, name);
      assert.equal(
        warns.length,
        0,
        warns.length
          ? `unexpected warnings:\n${warns.map((w) => `  - ${w}`).join("\n")}`
          : undefined,
      );
    });
  }
});
