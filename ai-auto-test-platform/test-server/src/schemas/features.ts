import { z } from "zod";
import type { FeaturesDocument } from "../pi/types.js";

const gherkinStepsSchema = z.object({
  scenario: z.string().min(1),
  given: z.array(z.string()).min(1),
  when: z.array(z.string()).min(1),
  then: z.array(z.string()).min(1),
  and: z.array(z.string()).optional(),
});

export const featureItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  sourceFile: z.string().min(1),
  route: z.string().optional(),
  gherkin: gherkinStepsSchema,
  gherkinText: z.string().min(1),
});

export const featuresDocumentSchema = z.object({
  version: z.literal("1.0"),
  generatedAt: z.string().min(1),
  repoPath: z.string().min(1),
  features: z.array(featureItemSchema).min(1),
});

export function parseFeaturesDocument(raw: unknown): FeaturesDocument {
  return featuresDocumentSchema.parse(raw);
}

/** 将结构化 Gherkin 步骤渲染为标准文本 */
export function renderGherkinText(gherkin: z.infer<typeof gherkinStepsSchema>): string {
  const lines = [`Scenario: ${gherkin.scenario}`];

  for (const step of gherkin.given) {
    lines.push(`  Given ${step}`);
  }
  for (const step of gherkin.when) {
    lines.push(`  When ${step}`);
  }
  if (gherkin.and) {
    for (const step of gherkin.and) {
      lines.push(`  And ${step}`);
    }
  }
  for (const step of gherkin.then) {
    lines.push(`  Then ${step}`);
  }

  return lines.join("\n");
}
