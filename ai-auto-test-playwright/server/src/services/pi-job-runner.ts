import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { PiRpcClient } from "../pi/rpc-client.js";
import type { PiProgressEvent, WsMessage } from "../pi/types.js";
import type { JobRecord, JobType } from "../repositories/job-repository.js";
import { JobRepository } from "../repositories/job-repository.js";
import { wsHub } from "../ws/ws-hub.js";

export interface PiJobContext {
  projectId: string;
  workspacePath: string;
  moduleName: string;
}

export interface PiJobDefinition {
  type: JobType;
  generatingWs: (ctx: PiJobContext, jobId: string) => WsMessage;
  readyWs: (ctx: PiJobContext, jobId: string, extra?: Record<string, string>) => WsMessage;
  failedWs: (ctx: PiJobContext, jobId: string, error: string) => WsMessage;
  buildPrompt: (ctx: PiJobContext, baseUrl: string) => string;
  validateOutput: (ctx: PiJobContext) => Promise<Record<string, unknown>>;
  onFailed?: (ctx: PiJobContext) => Promise<void>;
}

interface RunningJobHandle {
  cancelled: boolean;
  client: PiRpcClient | null;
  job: JobRecord;
}

export class PiJobRunner {
  private readonly jobs = new JobRepository();
  private readonly running = new Map<string, RunningJobHandle>();

  constructor(private readonly config: AppConfig) {}

  async startJob(
    ctx: PiJobContext,
    baseUrl: string,
    definition: PiJobDefinition,
  ): Promise<JobRecord> {
    const active = await this.jobs.findActiveByProject(ctx.projectId, definition.type);
    if (active) {
      throw new AppError(
        "JOB_ALREADY_RUNNING",
        `${definition.type} job already running: ${active.id}`,
        409,
      );
    }

    const now = new Date().toISOString();
    const job: JobRecord = {
      id: randomUUID(),
      projectId: ctx.projectId,
      type: definition.type,
      status: "running",
      error: null,
      result: { moduleName: ctx.moduleName },
      startedAt: now,
      finishedAt: null,
      createdAt: now,
    };

    await this.jobs.insert(job);
    this.running.set(job.id, { cancelled: false, client: null, job: structuredClone(job) });
    wsHub.broadcast(definition.generatingWs(ctx, job.id));

    void this.execute(job.id, ctx, baseUrl, definition).catch((err) => {
      console.error(`[pi-job] ${definition.type} ${job.id} failed:`, err);
    });

    return job;
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const handle = this.running.get(jobId);
    if (handle) return structuredClone(handle.job);
    return this.jobs.findById(jobId);
  }

  async cancelJob(jobId: string): Promise<JobRecord | null> {
    const handle = this.running.get(jobId);
    if (handle) {
      handle.cancelled = true;
      handle.job.status = "cancelled";
      handle.job.error = "Cancelled by user";
      handle.job.finishedAt = new Date().toISOString();
      handle.client?.stop();
      await this.jobs.update(handle.job);
      this.running.delete(jobId);
      return structuredClone(handle.job);
    }

    const existing = await this.jobs.findById(jobId);
    if (!existing || !["pending", "running"].includes(existing.status)) {
      return existing;
    }

    const cancelled: JobRecord = {
      ...existing,
      status: "cancelled",
      error: "Cancelled by user",
      finishedAt: new Date().toISOString(),
    };
    await this.jobs.update(cancelled);
    return cancelled;
  }

  private async execute(
    jobId: string,
    ctx: PiJobContext,
    baseUrl: string,
    definition: PiJobDefinition,
  ): Promise<void> {
    const handle = this.running.get(jobId);
    if (!handle) return;

    const client = new PiRpcClient({
      cwd: ctx.workspacePath,
      piCliPath: this.config.pi.cliPath,
      rpcArgs: this.config.pi.rpcArgs,
      commandTimeoutMs: 30_000,
      onProgress: (event) => this.onProgress(jobId, ctx.projectId, event),
    });

    handle.client = client;

    try {
      await client.start();
      if (handle.cancelled) return;

      await client.promptAndWait(definition.buildPrompt(ctx, baseUrl), this.config.pi.runTimeoutMs);
      if (handle.cancelled) return;

      const result = await definition.validateOutput(ctx);
      handle.job.status = "completed";
      handle.job.result = { ...(handle.job.result ?? {}), ...result };
      handle.job.finishedAt = new Date().toISOString();
      await this.jobs.update(handle.job);

      const extra =
        definition.type === "plan" && typeof result.planPath === "string"
          ? { planPath: result.planPath }
          : undefined;
      wsHub.broadcast(definition.readyWs(ctx, jobId, extra));
    } catch (err) {
      if (handle.cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      handle.job.status = "failed";
      handle.job.error = message;
      handle.job.finishedAt = new Date().toISOString();
      await this.jobs.update(handle.job);
      await definition.onFailed?.(ctx).catch(() => undefined);
      wsHub.broadcast(definition.failedWs(ctx, jobId, message));
    } finally {
      client.stop();
      this.running.delete(jobId);
    }
  }

  private onProgress(jobId: string, projectId: string, event: PiProgressEvent): void {
    if (event.kind === "text_delta") {
      wsHub.broadcast({
        type: "job_log",
        projectId,
        jobId,
        stream: "ai",
        text: event.delta,
      });
      return;
    }

    if (event.kind === "tool_start") {
      wsHub.broadcast({
        type: "job_log",
        projectId,
        jobId,
        stream: "tool",
        text: `[tool:${event.toolName}] ${JSON.stringify(event.args)}`,
      });
      return;
    }

    if (event.kind === "error") {
      wsHub.broadcast({
        type: "job_log",
        projectId,
        jobId,
        stream: "stderr",
        text: event.message,
      });
    }
  }
}
