import { Router } from "express";
import { isAppError } from "../errors.js";
import { JobRepository } from "../repositories/job-repository.js";
import type { PiJobRunner } from "../services/pi-job-runner.js";
import type { RunService } from "../services/run-service.js";

export function createJobsRouter(deps: {
  piJobRunner: PiJobRunner;
  runService: RunService;
  jobs?: JobRepository;
}): Router {
  const router = Router();
  const jobs = deps.jobs ?? new JobRepository();

  router.get("/:jobId", async (req, res) => {
    try {
      const job =
        (await deps.piJobRunner.getJob(req.params.jobId!)) ??
        (await jobs.findById(req.params.jobId!));
      if (!job) {
        res.status(404).json({
          ok: false,
          error: { code: "JOB_NOT_FOUND", message: "Job not found" },
        });
        return;
      }
      res.json({ ok: true, data: job });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/:jobId/cancel", async (req, res) => {
    try {
      const jobId = req.params.jobId!;
      const existing = await jobs.findById(jobId);

      if (existing?.type === "run") {
        const runId = existing.result?.runId;
        if (typeof runId === "string") {
          await deps.runService.cancelRun(runId);
        }
      } else {
        await deps.piJobRunner.cancelJob(jobId);
      }

      const job =
        (await deps.piJobRunner.getJob(jobId)) ?? (await jobs.findById(jobId));
      if (!job) {
        res.status(404).json({
          ok: false,
          error: { code: "JOB_NOT_FOUND", message: "Job not found" },
        });
        return;
      }
      res.json({ ok: true, data: job });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function sendError(res: import("express").Response, err: unknown): void {
  if (isAppError(err)) {
    res.status(err.statusCode).json({
      ok: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message } });
}
