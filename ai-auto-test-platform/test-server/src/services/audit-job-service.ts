import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { AuditProfile } from "../schemas/audit-profile.js";
import type {
  AuditJobState,
  AuditModuleJobState,
  AuditProgressEvent,
} from "../pi/types.js";
import { wsHub } from "../ws/ws-hub.js";
import type { ProjectService } from "./project-service.js";
import type { AuditService } from "./audit-service.js";

export class AuditJobService {
  private readonly runningJobs = new Map<
    string,
    { cancelled: boolean; job: AuditJobState; saveChain: Promise<void> }
  >();

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.config.auditJobsDir, { recursive: true });
    await this.recoverInterruptedJobs();
  }

  async startFullAudit(projectId: string): Promise<AuditJobState> {
    if (!this.config.auditFullEnabled) {
      throw new Error("Full modular audit is disabled (AUDIT_FULL_ENABLED=false)");
    }

    const project = await this.projectService.resolve(projectId);
    const profile = await this.auditService
      .getProfileService()
      .resolveForProject(projectId, project.auditProfile);

    if (!profile) {
      throw new Error(
        `No audit profile found for project ${projectId}. Set auditProfile or add audit-profiles/${projectId}.json`,
      );
    }

    const jobId = randomUUID();
    const now = new Date().toISOString();
    const job: AuditJobState = {
      id: jobId,
      projectId,
      mode: "full",
      status: "running",
      createdAt: now,
      updatedAt: now,
      repoPath: project.repoPath,
      modules: profile.modules.map((m) => ({
        id: m.id,
        title: m.title,
        status: "pending" as const,
      })),
      featureCount: 0,
    };

    await this.persistJob(job);
    this.runningJobs.set(jobId, {
      cancelled: false,
      job: structuredClone(job),
      saveChain: Promise.resolve(),
    });

    wsHub.broadcast({
      type: "audit_job_started",
      jobId,
      projectId,
      moduleCount: profile.modules.length,
    });

    void this.executeJob(jobId, profile).catch((err) => {
      console.error(`[audit-job] ${jobId} failed:`, err);
    });

    return job;
  }

  async getJob(jobId: string): Promise<AuditJobState | null> {
    const running = this.runningJobs.get(jobId);
    if (running) {
      return structuredClone(running.job);
    }

    try {
      const raw = await fs.readFile(this.jobPath(jobId), "utf8");
      return JSON.parse(raw) as AuditJobState;
    } catch {
      return null;
    }
  }

  async cancelJob(jobId: string): Promise<AuditJobState | null> {
    const handle = this.runningJobs.get(jobId);
    if (handle) {
      handle.cancelled = true;
      handle.job.status = "cancelled";
      handle.job.error = "Cancelled by user";
      handle.job.updatedAt = new Date().toISOString();
      await this.enqueueSave(jobId, handle.job);
    }

    return this.getJob(jobId);
  }

  private async executeJob(jobId: string, profile: AuditProfile): Promise<void> {
    const handle = this.runningJobs.get(jobId);
    if (!handle) return;

    const updateJob = (patch: Partial<AuditJobState>) => {
      Object.assign(handle.job, patch, { updatedAt: new Date().toISOString() });
    };

    const updateModule = (
      moduleId: string,
      patch: Partial<AuditModuleJobState>,
    ) => {
      handle.job.modules = handle.job.modules.map((m) =>
        m.id === moduleId ? { ...m, ...patch } : m,
      );
      handle.job.updatedAt = new Date().toISOString();
    };

    const onProgress = (event: AuditProgressEvent) => {
      if (handle.cancelled) return;

      if (event.kind === "module_started") {
        updateJob({ currentModuleId: event.moduleId });
        updateModule(event.moduleId, { status: "running" });
        void this.enqueueSave(jobId, handle.job);
        wsHub.broadcast({
          type: "audit_module_started",
          jobId,
          moduleId: event.moduleId,
          moduleTitle: event.moduleTitle,
        });
      }

      if (event.kind === "module_completed") {
        updateModule(event.moduleId, {
          status: "completed",
          featureCount: event.featureCount,
        });
        handle.job.featureCount = handle.job.modules
          .filter((m) => m.status === "completed")
          .reduce((sum, m) => sum + (m.featureCount ?? 0), 0);
        void this.enqueueSave(jobId, handle.job);
        wsHub.broadcast({
          type: "audit_module_completed",
          jobId,
          moduleId: event.moduleId,
          moduleTitle: event.moduleTitle,
          featureCount: event.featureCount,
        });
      }

      if (event.kind === "module_failed") {
        updateModule(event.moduleId, {
          status: "failed",
          error: event.message,
        });
        void this.enqueueSave(jobId, handle.job);
        wsHub.broadcast({
          type: "audit_module_failed",
          jobId,
          moduleId: event.moduleId,
          moduleTitle: event.moduleTitle,
          message: event.message,
        });
      }

      if (event.kind === "merge_completed") {
        handle.job.featureCount = event.featureCount;
        void this.enqueueSave(jobId, handle.job);
        wsHub.broadcast({
          type: "audit_merge_completed",
          jobId,
          featureCount: event.featureCount,
        });
      }

      if (event.kind === "text_delta") {
        process.stdout.write(event.delta);
      }
    };

    try {
      if (handle.cancelled) return;

      const result = await this.auditService.runFullAuditModules({
        projectId: handle.job.projectId,
        modules: profile.modules,
        skipCompleted: true,
        onProgress,
      });

      if (handle.cancelled) return;

      updateJob({
        status: "completed",
        featureCount: result.features.features.length,
        featuresPath: result.featuresPath,
        currentModuleId: undefined,
      });
      await this.enqueueSave(jobId, handle.job);

      wsHub.broadcast({
        type: "audit_job_completed",
        jobId,
        featureCount: result.features.features.length,
        success: true,
        message: `完整審計完成，共 ${result.features.features.length} 條劇本`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateJob({
        status: "failed",
        error: message,
        currentModuleId: undefined,
      });
      await this.enqueueSave(jobId, handle.job);

      wsHub.broadcast({
        type: "audit_job_completed",
        jobId,
        featureCount: handle.job.featureCount,
        success: false,
        message,
      });
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  private async enqueueSave(jobId: string, job: AuditJobState): Promise<void> {
    const handle = this.runningJobs.get(jobId);
    if (!handle) {
      await this.persistJob(job);
      return;
    }

    handle.saveChain = handle.saveChain.then(() => this.persistJob(job));
    await handle.saveChain;
  }

  private async recoverInterruptedJobs(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.config.auditJobsDir);
    } catch {
      return;
    }

    for (const file of entries) {
      if (!file.endsWith(".json")) continue;
      const jobId = file.replace(/\.json$/, "");
      const job = await this.getJob(jobId);
      if (job?.status === "running") {
        job.status = "failed";
        job.error = "Interrupted by server restart";
        job.updatedAt = new Date().toISOString();
        await this.persistJob(job);
      }
    }
  }

  private jobPath(jobId: string): string {
    return path.join(this.config.auditJobsDir, `${jobId}.json`);
  }

  private async persistJob(job: AuditJobState): Promise<void> {
    await fs.mkdir(this.config.auditJobsDir, { recursive: true });
    const target = this.jobPath(job.id);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(job, null, 2) + "\n", "utf8");
    await fs.rename(tmp, target);
  }
}
