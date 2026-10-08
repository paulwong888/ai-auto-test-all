import type { JobRecord, JobStatus } from "../repositories/job-repository.js";
import type { PiJobRunner } from "./pi-job-runner.js";

const TERMINAL: JobStatus[] = ["completed", "failed", "cancelled"];

export async function waitForJob(
  piJobs: PiJobRunner,
  jobId: string,
  timeoutMs = 1_800_000,
  pollMs = 3_000,
): Promise<JobRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await piJobs.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (TERMINAL.includes(job.status)) {
      return job;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
