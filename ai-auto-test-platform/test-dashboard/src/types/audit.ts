export type AuditModuleJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface AuditModuleJobState {
  id: string;
  title: string;
  status: AuditModuleJobStatus;
  featureCount?: number;
  error?: string;
}

export type AuditJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AuditJobState {
  id: string;
  projectId: string;
  mode: "full";
  status: AuditJobStatus;
  createdAt: string;
  updatedAt: string;
  repoPath: string;
  currentModuleId?: string;
  modules: AuditModuleJobState[];
  featureCount: number;
  error?: string;
  featuresPath?: string;
}

export type AuditWsMessage =
  | { type: "audit_job_started"; jobId: string; projectId: string; moduleCount: number }
  | { type: "audit_module_started"; jobId: string; moduleId: string; moduleTitle: string }
  | {
      type: "audit_module_completed";
      jobId: string;
      moduleId: string;
      moduleTitle: string;
      featureCount: number;
    }
  | {
      type: "audit_module_failed";
      jobId: string;
      moduleId: string;
      moduleTitle: string;
      message: string;
    }
  | { type: "audit_merge_completed"; jobId: string; featureCount: number }
  | {
      type: "audit_job_completed";
      jobId: string;
      featureCount: number;
      success: boolean;
      message: string;
    };
