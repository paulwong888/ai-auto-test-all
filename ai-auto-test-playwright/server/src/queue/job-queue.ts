import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

export interface QueueJobPayload {
  type: "plan" | "code" | "fix" | "run" | "record";
  projectId: string;
  jobId: string;
  data: Record<string, unknown>;
}

export type QueueHandler = (payload: QueueJobPayload) => Promise<void>;

const JOB_PRIORITY: Record<string, number> = {
  run_manual: 10,
  fix_verify: 8,
  record: 7,
  run_ci: 5,
  plan: 3,
  code: 3,
  fix: 3,
  run: 5,
};

let queue: Queue<QueueJobPayload> | null = null;
let worker: Worker<QueueJobPayload> | null = null;

function redisConnection(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function isQueueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function getJobQueue(): Queue<QueueJobPayload> | null {
  if (!isQueueEnabled()) return null;
  if (!queue) {
    const connection = redisConnection()!;
    queue = new Queue<QueueJobPayload>("ai-auto-test-jobs", { connection });
  }
  return queue;
}

export async function enqueueJob(payload: QueueJobPayload): Promise<void> {
  const q = getJobQueue();
  if (!q) return;
  const priorityKey = String(payload.data.purpose ?? payload.type);
  await q.add(payload.type, payload, {
    jobId: payload.jobId,
    priority: JOB_PRIORITY[priorityKey] ?? 5,
  });
}

export function startQueueWorker(handler: QueueHandler): void {
  if (!isQueueEnabled() || worker) return;
  const connection = redisConnection()!;
  worker = new Worker<QueueJobPayload>(
    "ai-auto-test-jobs",
    async (job: Job<QueueJobPayload>) => {
      await handler(job.data);
    },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3) },
  );
  worker.on("failed", (job, err) => {
    console.error(`[queue] job ${job?.id} failed:`, err);
  });
}
