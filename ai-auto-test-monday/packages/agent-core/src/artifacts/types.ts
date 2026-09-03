import { z } from "zod";

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
  ]),
  snippet: z.string().optional(),
});

export const testIdInjectionsSchema = z.object({
  dryRun: z.literal(true),
  generatedAt: z.string(),
  patches: z.array(injectionPatchSchema),
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
