import { z } from "zod";

export const cloneStatusSchema = z.enum([
  "idle",
  "cloning",
  "ready",
  "failed",
]);

const gitUrlSchema = z
  .string()
  .min(1)
  .optional()
  .or(z.literal(""));

export const createProjectSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  frontendGitUrl: gitUrlSchema,
  frontendBranch: z.string().default("main"),
  backendGitUrl: gitUrlSchema,
  backendBranch: z.string().default("main"),
  localPathOverride: z.string().optional(),
  targetUrl: z.string().url().optional().or(z.literal("")),
});

export const updateProjectSchema = createProjectSchema.partial();

export const runPipelineSchema = z.object({
  projectId: z.string().min(1),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type RunPipelineInput = z.infer<typeof runPipelineSchema>;
