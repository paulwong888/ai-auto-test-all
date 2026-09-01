import { z } from "zod";
import type { FeatureItem, GherkinSteps } from "../pi/types.js";
import { featureItemSchema } from "./features.js";

const gherkinStepsSchema = z.object({
  scenario: z.string().min(1),
  given: z.array(z.string()).min(1),
  when: z.array(z.string()).min(1),
  then: z.array(z.string()).min(1),
  and: z.array(z.string()).optional(),
});

/** 模块局部文件允许 Pi 只写 gherkinText，合并前规范化 */
export const moduleFeatureItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  sourceFile: z.string().optional(),
  route: z.string().optional(),
  gherkin: gherkinStepsSchema.optional(),
  gherkinText: z.string().min(1),
});

export const modulePartialSchema = z.object({
  moduleId: z.string().min(1),
  features: z.array(moduleFeatureItemSchema).min(1),
});

export type ModulePartial = z.infer<typeof modulePartialSchema>;

const phasePrefixes: Array<{
  phase: "given" | "when" | "then" | "and";
  labels: string[];
}> = [
  { phase: "given", labels: ["Given ", "假設 ", "假定 "] },
  { phase: "when", labels: ["When ", "當 ", "当 "] },
  { phase: "then", labels: ["Then ", "那麼 ", "那么 "] },
  { phase: "and", labels: ["And ", "並且 ", "并且 ", "而且 "] },
];

function parseGherkinText(text: string): GherkinSteps {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let scenario = "未命名場景";
  const steps: GherkinSteps = {
    scenario,
    given: [],
    when: [],
    then: [],
    and: [],
  };

  for (const line of lines) {
    const scenarioMatch = line.match(/^(?:Scenario|情境|場景)[:：]\s*(.+)$/i);
    if (scenarioMatch) {
      scenario = scenarioMatch[1]!.trim();
      continue;
    }

    let matched = false;
    for (const { phase, labels } of phasePrefixes) {
      for (const label of labels) {
        if (line.startsWith(label)) {
          const value = line.slice(label.length).trim();
          if (phase === "and") {
            steps.and!.push(value);
          } else if (phase === "given" || phase === "when" || phase === "then") {
            steps[phase].push(value);
          }
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  steps.scenario = scenario;
  if (steps.given.length === 0) steps.given.push("使用者已登入系統");
  if (steps.when.length === 0) steps.when.push("使用者執行操作");
  if (steps.then.length === 0) steps.then.push("系統顯示預期結果");
  if (steps.and!.length === 0) delete steps.and;

  return steps;
}

export function normalizeModuleFeature(
  raw: z.infer<typeof moduleFeatureItemSchema>,
  moduleId: string,
): FeatureItem {
  const gherkin = raw.gherkin ?? parseGherkinText(raw.gherkinText);
  const candidate = {
    id: raw.id,
    title: raw.title,
    description: raw.description || raw.title,
    sourceFile: raw.sourceFile ?? "src/App.js",
    route: raw.route,
    gherkin,
    gherkinText: raw.gherkinText,
  };

  const parsed = featureItemSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  return featureItemSchema.parse({
    ...candidate,
    id: raw.id.startsWith(moduleId) ? raw.id : `${moduleId}-${raw.id}`,
  });
}

export function normalizeModulePartial(raw: unknown): ModulePartial {
  return modulePartialSchema.parse(raw);
}

export function modulePartialToFeatures(partial: ModulePartial): FeatureItem[] {
  return partial.features.map((f) => normalizeModuleFeature(f, partial.moduleId));
}
