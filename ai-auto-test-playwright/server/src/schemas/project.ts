import { z } from "zod";

export const projectStatusSchema = z.enum(["created", "active", "archived"]);
export const workflowStageSchema = z.enum(["init", "recorded", "plan", "code", "run"]);
export const stageStatusSchema = z.enum(["idle", "generating", "running", "failed"]);

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  workspacePath: z.string().min(1),
  status: projectStatusSchema,
  workflowStage: workflowStageSchema,
  stageStatus: stageStatusSchema,
  moduleName: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  workspacePath: z.string().min(1),
});

export const updateProjectInputSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  workspacePath: z.string().min(1).optional(),
  status: projectStatusSchema.optional(),
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
