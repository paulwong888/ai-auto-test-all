import { z } from "zod";
import {
  JOURNEY_CATEGORIES,
  normalizeJourneyCategory,
  type JourneyCategory,
} from "../lib/journey-category.js";

export { JOURNEY_CATEGORIES, type JourneyCategory } from "../lib/journey-category.js";

export const interactiveElementSchema = z.object({
  elementType: z.string(),
  role: z.string(),
  binding: z.string().nullable().optional(),
  handler: z.string().optional(),
  attributes: z.record(z.string()).optional(),
  line: z.number().optional(),
  existingTestId: z.string().optional(),
  ariaLabel: z.string().optional(),
});

export const componentSchema = z.object({
  name: z.string(),
  type: z.string().default("react"),
  filePath: z.string(),
  props: z.array(z.object({ name: z.string(), type: z.string().optional() })).optional(),
  state: z.array(z.object({ name: z.string(), initial: z.string().optional() })).optional(),
  interactiveElements: z.array(interactiveElementSchema).default([]),
  conditionalRendering: z
    .array(
      z.object({
        condition: z.string(),
        renders: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
  featureFlags: z.array(z.string()).optional(),
  businessSemantics: z.string().optional(),
});

export const componentRegistrySchema = z.object({
  version: z.string(),
  projectId: z.string(),
  runId: z.string(),
  frontendPath: z.string(),
  scannedAt: z.string(),
  scanStats: z.object({
    filesScanned: z.number(),
    componentsFound: z.number(),
    parseErrors: z.number(),
  }),
  components: z.array(componentSchema),
});

export const injectionPatchSchema = z.object({
  file: z.string(),
  line: z.number(),
  component: z.string(),
  elementRole: z.string(),
  testId: z.string(),
  action: z.enum([
    "inject-testid",
    "uses-existing-testid",
    "uses-existing-aria-label",
    "uses-structural-attribute",
    "rename-existing-testid",
    "resolve-conflict",
  ]),
  snippet: z.string().optional(),
  previousTestId: z.string().optional(),
});

export const testIdInjectionsSchema = z.object({
  dryRun: z.boolean(),
  generatedAt: z.string(),
  patches: z.array(injectionPatchSchema),
});

export const applyPatchResultSchema = z.object({
  file: z.string(),
  line: z.number(),
  testId: z.string(),
  status: z.enum(["applied", "skipped", "failed"]),
  message: z.string().optional(),
});

export const applyReportSchema = z.object({
  generatedAt: z.string(),
  dryRun: z.literal(false),
  applied: z.number(),
  skipped: z.number(),
  failed: z.number(),
  results: z.array(applyPatchResultSchema),
});

export const locatorEntrySchema = z.object({
  component: z.string(),
  element: z.string(),
  testId: z.string().optional(),
  priority: z.array(z.string()),
});

export const locatorCatalogSchema = z.object({
  generatedAt: z.string(),
  locators: z.array(locatorEntrySchema),
});

export type InteractiveElement = z.infer<typeof interactiveElementSchema>;
export type ComponentEntry = z.infer<typeof componentSchema>;
export type ComponentRegistry = z.infer<typeof componentRegistrySchema>;
export type TestIdInjections = z.infer<typeof testIdInjectionsSchema>;
export type LocatorCatalog = z.infer<typeof locatorCatalogSchema>;

export type RawComponent = ComponentEntry;

export const scriptAnalystEnhancementSchema = z.object({
  components: z.array(
    z.object({
      name: z.string(),
      filePath: z.string(),
      businessSemantics: z.string().optional(),
      interactiveElements: z
        .array(
          z.object({
            role: z.string(),
            handler: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

export const pomGenerationSchema = z.object({
  files: z.array(
    z.object({
      fileName: z.string(),
      content: z.string(),
    }),
  ),
});

const journeyCategorySchema = z.enum(JOURNEY_CATEGORIES);

export const journeyStepSchema = z.object({
  step: z.number(),
  action: z.enum(["navigate", "assert_visible", "interact", "assert_state"]),
  pom: z.string(),
  method: z.string(),
  args: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  description: z.string().optional(),
});

export const journeySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
  category: journeyCategorySchema.optional(),
  gherkinText: z.string(),
  steps: z.array(journeyStepSchema),
  expectedOutcome: z.string().optional(),
});

export const journeysDocumentSchema = z.object({
  version: z.string().default("1.0"),
  generatedAt: z.string(),
  targetUrl: z.string().optional(),
  journeys: z.array(journeySchema),
  summary: z
    .object({
      journeyCount: z.number(),
      componentsCovered: z.array(z.string()),
    })
    .optional(),
});

export const journeyFromLlmSchema = journeySchema.omit({ category: true }).extend({
  category: z
    .union([journeyCategorySchema, z.string()])
    .optional()
    .transform((val): JourneyCategory | undefined => normalizeJourneyCategory(val)),
});

export const journeyGenerationSchema = z.object({
  journeys: z.array(journeySchema),
});

export const journeyGenerationFromLlmSchema = z.object({
  journeys: z.array(journeyFromLlmSchema),
});

export const specGenerationSchema = z.object({
  files: z.array(
    z.object({
      fileName: z.string(),
      content: z.string(),
    }),
  ),
});

export type JourneyStep = z.infer<typeof journeyStepSchema>;
export type Journey = z.infer<typeof journeySchema>;
export type JourneysDocument = z.infer<typeof journeysDocumentSchema>;
export type ApplyReport = z.infer<typeof applyReportSchema>;
export type ApplyPatchResult = z.infer<typeof applyPatchResultSchema>;
export type InjectionPatch = z.infer<typeof injectionPatchSchema>;

export const executionResultSchema = z.object({
  journeyId: z.string(),
  title: z.string(),
  status: z.enum(["passed", "failed", "skipped", "flaky"]),
  failureType: z.enum(["A", "B", "C"]).optional(),
  attempts: z.number(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
  executionMode: z.enum(["platform", "direct"]).optional(),
});

export const executionReportSchema = z.object({
  version: z.literal("1.0"),
  generatedAt: z.string(),
  executionMode: z.enum(["platform", "direct", "auto"]),
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    flaky: z.number().optional(),
  }),
  results: z.array(executionResultSchema),
});

export type ExecutionReport = z.infer<typeof executionReportSchema>;
export type ExecutionResult = z.infer<typeof executionResultSchema>;
