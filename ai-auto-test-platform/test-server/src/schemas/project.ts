import { z } from "zod";

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repoPath: z.string().min(1),
  targetUrl: z.string().url(),
  auditProfile: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const createProjectInputSchema = z.object({
  name: z.string().min(1),
  repoPath: z.string().min(1),
  targetUrl: z.string().url(),
  auditProfile: z.string().min(1).optional(),
});

export const updateProjectInputSchema = z.object({
  name: z.string().min(1).optional(),
  repoPath: z.string().min(1).optional(),
  targetUrl: z.string().url().optional(),
  auditProfile: z.string().min(1).optional(),
});

export const projectsFileSchema = z.object({
  version: z.literal("1.0"),
  projects: z.array(projectSchema),
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type ProjectsFile = z.infer<typeof projectsFileSchema>;

/** 将展示名转为 slug id */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 64) || "project";
}

export function uniqueProjectId(base: string, existing: Set<string>): string {
  let id = base;
  let n = 2;
  while (existing.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}
