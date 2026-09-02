import { z } from "zod";

export const manualAccountSchema = z.object({
  role: z.string().min(1),
  username: z.string().min(1),
  password: z.string().optional(),
  note: z.string().optional(),
});

export const manualConfigSchema = z.object({
  accounts: z.array(manualAccountSchema).optional(),
  env: z.record(z.string()).optional(),
  notes: z.string().optional(),
});

export type ManualAccount = z.infer<typeof manualAccountSchema>;
export type ManualConfig = z.infer<typeof manualConfigSchema>;

export const updateFeatureInputSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    sourceFile: z.string().min(1).optional(),
    route: z.string().optional(),
    gherkin: z
      .object({
        scenario: z.string().min(1),
        given: z.array(z.string()).min(1),
        when: z.array(z.string()).min(1),
        then: z.array(z.string()).min(1),
        and: z.array(z.string()).optional(),
      })
      .optional(),
    gherkinText: z.string().min(1).optional(),
    manualConfig: manualConfigSchema.optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.sourceFile !== undefined ||
      data.route !== undefined ||
      data.gherkin !== undefined ||
      data.gherkinText !== undefined ||
      data.manualConfig !== undefined,
    { message: "At least one field required" },
  );

export type UpdateFeatureInput = z.infer<typeof updateFeatureInputSchema>;

export type FeatureSource = "audit" | "import" | "manual";
