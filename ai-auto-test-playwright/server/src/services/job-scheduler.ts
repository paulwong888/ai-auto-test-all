import { randomUUID } from "node:crypto";
import { JobRepository } from "../repositories/job-repository.js";
import { enqueueJob, isQueueEnabled, startQueueWorker, type QueueJobPayload } from "../queue/job-queue.js";
import { JobDeferredError, withProjectLock } from "./project-lock.js";
import { wsHub } from "../ws/ws-hub.js";

export type JobHandlerRegistry = Record<
  string,
  (projectId: string, jobId: string, data: Record<string, unknown>) => Promise<void>
>;

export class JobScheduler {
  private readonly jobs = new JobRepository();
  private handlers: JobHandlerRegistry = {};
  private started = false;

  registerHandlers(handlers: JobHandlerRegistry): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  start(): void {
    if (this.started || !isQueueEnabled()) return;
    this.started = true;
    startQueueWorker(async (payload) => {
      await this.processJob(payload);
    });
    console.log("[job-scheduler] BullMQ worker started");
  }

  async submit(
    type: QueueJobPayload["type"],
    projectId: string,
    data: Record<string, unknown> = {},
  ): Promise<string> {
    const jobId = randomUUID();
    await this.jobs.insert({
      id: jobId,
      projectId,
      type,
      status: isQueueEnabled() ? "pending" : "running",
      error: null,
      result: data,
      startedAt: isQueueEnabled() ? null : new Date().toISOString(),
      finishedAt: null,
    });

    const payload: QueueJobPayload = { type, projectId, jobId, data };

    if (isQueueEnabled()) {
      await enqueueJob(payload);
      wsHub.broadcast({ type: "job_queued", projectId, jobId, jobType: type });
      return jobId;
    }

    void this.processJob(payload).catch((err) => {
      console.error(`[job-scheduler] inline job ${jobId} failed:`, err);
    });
    return jobId;
  }

  private async processJob(payload: QueueJobPayload): Promise<void> {
    const handler = this.handlers[payload.type];
    if (!handler) {
      throw new Error(`No handler for job type ${payload.type}`);
    }

    const job = await this.jobs.findById(payload.jobId);
    if (!job) return;

    try {
      await withProjectLock(payload.projectId, async () => {
        await this.jobs.update({
          ...job,
          status: "running",
          startedAt: new Date().toISOString(),
        });
        wsHub.broadcast({
          type: "job_started",
          projectId: payload.projectId,
          jobId: payload.jobId,
        });
        await handler(payload.projectId, payload.jobId, payload.data);
        const latest = await this.jobs.findById(payload.jobId);
        if (latest && latest.status === "running") {
          await this.jobs.update({
            ...latest,
            status: "completed",
            finishedAt: new Date().toISOString(),
          });
        }
        wsHub.broadcast({
          type: "job_completed",
          projectId: payload.projectId,
          jobId: payload.jobId,
        });
      });
    } catch (err) {
      if (err instanceof JobDeferredError) {
        await enqueueJob(payload);
        return;
      }
      const latest = await this.jobs.findById(payload.jobId);
      if (latest) {
        await this.jobs.update({
          ...latest,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          finishedAt: new Date().toISOString(),
        });
      }
      wsHub.broadcast({
        type: "job_failed",
        projectId: payload.projectId,
        jobId: payload.jobId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
