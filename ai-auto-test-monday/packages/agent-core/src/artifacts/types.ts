import { z } from "zod";
import {
  JOURNEY_CATEGORIES,
  normalizeJourneyCategory,
  type JourneyCategory,
} from "../lib/journey-category.js";

export { JOURNEY_CATEGORIES, type JourneyCategory } from "../lib/journey-category.js";

export const PAGE_KINDS = [
  "interactive",
  "read-only",
  "layout",
  "provider",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

export const CONDITIONAL_SEMANTIC_TYPES = [
  "error-state",
  "loading-state",
  "permission-guard",
  "feature-flag",
] as const;

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

export const componentPropSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().nullable().optional(),
  description: z.string().optional(),
});

export const conditionalRenderingSchema = z.object({
  condition: z.string(),
  renders: z.string().optional(),
  type: z.string().optional(),
  semanticType: z.enum(CONDITIONAL_SEMANTIC_TYPES).optional(),
});

export const componentSchema = z.object({
  name: z.string(),
  type: z.string().default("react"),
  filePath: z.string(),
  pageKind: z.enum(PAGE_KINDS).optional(),
  excludeFromPom: z.boolean().optional(),
  props: z.array(componentPropSchema).optional(),
  state: z.array(z.object({ name: z.string(), initial: z.string().optional() })).optional(),
  interactiveElements: z.array(interactiveElementSchema).default([]),
  conditionalRendering: z.array(conditionalRenderingSchema).optional(),
  featureFlags: z.array(z.string()).optional(),
  businessSemantics: z.string().optional(),
  childComponents: z.array(z.string()).optional(),
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
      businessSemantics: z.string().nullable().optional(),
      interactiveElements: z
        .array(
          z.object({
            role: z.string(),
            handler: z.string().nullable().optional(),
          }),
        )
        .nullable()
        .optional(),
    }),
  ),
});

const reconcilePropSchema = z.object({
  name: z.string(),
  type: z.string().nullable().optional(),
  required: z.boolean().nullable().optional(),
  description: z.string().nullable().optional(),
});

const conditionalSemanticPatchSchema = z.object({
  condition: z
    .string()
    .describe("Exact condition string from astSkeleton; do not invent or rewrite"),
  semanticType: z
    .enum(CONDITIONAL_SEMANTIC_TYPES)
    .nullable()
    .optional()
    .describe(
      "error-state | loading-state | permission-guard | feature-flag; omit patch if unknown",
    ),
});

const handlerPatchSchema = z.object({
  role: z
    .string()
    .describe("Must match an interactiveElements[].role from astSkeleton"),
  handler: z
    .string()
    .nullable()
    .optional()
    .describe("Handler semantics only, e.g. onClick → submitLogin"),
});

export const scriptAnalystReconcileComponentSchema = z.object({
  name: z.string().describe("Component name; must match astSkeleton"),
  filePath: z.string().describe("Source file path; must match astSkeleton"),
  pageKind: z
    .enum(PAGE_KINDS)
    .nullable()
    .optional()
    .describe("Page kind if inferrable"),
  props: z
    .array(reconcilePropSchema)
    .nullable()
    .optional()
    .describe("Only props needing description enrichment"),
  featureFlags: z.array(z.string()).nullable().optional(),
  businessSemantics: z
    .string()
    .nullable()
    .optional()
    .describe("One brief sentence of business meaning"),
  childComponents: z
    .array(z.union([z.string(), z.record(z.unknown())]))
    .nullable()
    .optional()
    .transform((items) => {
      if (items == null) return items;
      return items.map((item) => {
        if (typeof item === "string") return item;
        const name = item.name;
        if (typeof name === "string") return name;
        return String(name ?? item);
      });
    })
    .describe("Child component names as plain strings only"),
  conditionalSemanticPatches: z
    .array(conditionalSemanticPatchSchema)
    .nullable()
    .optional()
    .describe(
      "Sparse semantic tags for known conditions only; omit if none apply",
    ),
  handlerPatches: z
    .array(handlerPatchSchema)
    .nullable()
    .optional()
    .describe("Sparse handler enrichments for known roles only; omit if none"),
});

export const scriptAnalystReconcileSchema = z.object({
  components: z.array(scriptAnalystReconcileComponentSchema),
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
  args: z.array(z.union([z.string(), z.number(), z.boolean()])).nullable().optional(),
  description: z.string().nullable().optional(),
});

export const journeySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  priority: z.enum(["P1", "P2", "P3", "P4"]).nullable().optional(),
  category: journeyCategorySchema.nullable().optional(),
  gherkinText: z.string(),
  steps: z.array(journeyStepSchema),
  expectedOutcome: z.string().nullable().optional(),
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
    .nullable()
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

export const routeEntrySchema = z.object({
  path: z.string(),
  component: z.string(),
  public: z.boolean().optional(),
  requiresFeatureFlag: z.string().optional(),
  sourceFile: z.string().optional(),
  line: z.number().optional(),
});

export const navLinkSchema = z.object({
  fromComponent: z.string(),
  toPath: z.string(),
  label: z.string().optional(),
  testId: z.string().optional(),
  sourceFile: z.string().optional(),
});

export const routeConfigSchema = z.object({
  version: z.literal("1.0"),
  generatedAt: z.string(),
  framework: z.string().default("react-router"),
  routes: z.array(routeEntrySchema),
  navLinks: z.array(navLinkSchema).optional(),
});

export const guardEntrySchema = z.object({
  route: z.string(),
  allowedRoles: z.array(z.string()),
  guardType: z.enum(["route-guard", "business-flow", "none"]),
  unauthenticatedBehavior: z.string().optional(),
  evidence: z.string().optional(),
  sourceFile: z.string().optional(),
});

export const permissionModelSchema = z.object({
  version: z.literal("1.0"),
  generatedAt: z.string(),
  roles: z.array(z.string()),
  guards: z.array(guardEntrySchema),
  summary: z.object({
    routeGuardCount: z.number(),
    businessFlowCount: z.number(),
    publicRouteCount: z.number(),
  }),
});

export type RouteEntry = z.infer<typeof routeEntrySchema>;
export type NavLink = z.infer<typeof navLinkSchema>;
export type RouteConfigDocument = z.infer<typeof routeConfigSchema>;
export type GuardEntry = z.infer<typeof guardEntrySchema>;
export type PermissionModelDocument = z.infer<typeof permissionModelSchema>;
