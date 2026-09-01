import { z } from "zod";

export const auditModuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  routes: z.array(z.string()).min(1),
  sourceDirs: z.array(z.string()).optional(),
});

export const auditProfileSchema = z.object({
  projectId: z.string().min(1),
  modules: z.array(auditModuleSchema).min(1),
});

export type AuditModule = z.infer<typeof auditModuleSchema>;
export type AuditProfile = z.infer<typeof auditProfileSchema>;
