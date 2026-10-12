import { z } from "zod";

const envKeySchema = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9_]*$/, "Key must look like an env var (e.g. SALES_PORTAL_CRM_API_BEARER)");

export const projectEnvVariableSchema = z.object({
  key: envKeySchema,
  value: z.string().optional(),
  isSecret: z.boolean().default(false),
});

export const projectEnvSettingsInputSchema = z.object({
  variables: z.array(projectEnvVariableSchema),
});

export type ProjectEnvVariableInput = z.infer<typeof projectEnvVariableSchema>;
export type ProjectEnvSettingsInput = z.infer<typeof projectEnvSettingsInputSchema>;
