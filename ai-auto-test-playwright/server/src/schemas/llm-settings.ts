import { z } from "zod";

export const llmProviderSchema = z.enum(["dashscope", "higress", "openai-compatible"]);

export const globalLlmSettingsSchema = z.object({
  provider: llmProviderSchema,
  baseUrl: z.string().url(),
  defaultModel: z.string().min(1),
  extraModels: z.array(z.string().min(1)).default([]),
  apiKey: z.string().optional(),
});

export const projectLlmOverrideSchema = z.object({
  enabled: z.boolean(),
  provider: llmProviderSchema.optional(),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().min(1).optional(),
  extraModels: z.array(z.string().min(1)).optional(),
  apiKey: z.string().optional(),
});

export type GlobalLlmSettingsInput = z.infer<typeof globalLlmSettingsSchema>;
export type ProjectLlmOverrideInput = z.infer<typeof projectLlmOverrideSchema>;
