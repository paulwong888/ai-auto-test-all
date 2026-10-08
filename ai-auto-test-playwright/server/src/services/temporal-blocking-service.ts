import { AppError } from "../errors.js";
import type { JobRecord } from "../repositories/job-repository.js";
import type { RunRecord } from "../repositories/run-repository.js";
import type { PlatformPipelineStage } from "../temporal/workflow-constants.js";
import { waitForJob } from "./job-waiter.js";
import type { CodegenService } from "./codegen-service.js";
import type { FixService } from "./fix-service.js";
import type { PlanService } from "./plan-service.js";
import type { PiJobRunner } from "./pi-job-runner.js";
import type { PlatformPipelineRepository } from "../repositories/platform-pipeline-repository.js";
import { waitForRun } from "./run-waiter.js";
import type { RunService } from "./run-service.js";
import { wsHub } from "../ws/ws-hub.js";

export class TemporalBlockingService {
  constructor(
    private readonly deps: {
      planService: PlanService;
      codegenService: CodegenService;
      runService: RunService;
      fixService: FixService;
      piJobs: PiJobRunner;
      pipelineRuns: PlatformPipelineRepository;
    },
  ) {}

  private async touchPipeline(
    pipelineRunId: string | undefined,
    patch: {
      currentStage?: PlatformPipelineStage;
      runId?: string | null;
      fixIteration?: number;
      error?: string | null;
    },
  ): Promise<void> {
    if (!pipelineRunId) return;
    const updated = await this.deps.pipelineRuns.update(pipelineRunId, patch);
    if (updated) {
      wsHub.broadcast({
        type: "pipeline_progress",
        pipelineRunId: updated.id,
        projectId: updated.projectId,
        stage: updated.currentStage,
        status: updated.status,
        runId: updated.runId,
        fixIteration: updated.fixIteration,
        error: updated.error ?? undefined,
      });
    }
  }

  async runPlan(input: {
    projectId: string;
    moduleName: string;
    pipelineRunId?: string;
  }): Promise<{ jobId: string; status: string }> {
    await this.touchPipeline(input.pipelineRunId, { currentStage: "plan" });
    const job = await this.deps.planService.startPlanGeneration(
      input.projectId,
      input.moduleName,
    );
    const finished = await waitForJob(this.deps.piJobs, job.id);
    if (finished.status !== "completed") {
      throw new AppError(
        "PIPELINE_PLAN_FAILED",
        finished.error ?? "Plan generation failed",
        500,
      );
    }
    return { jobId: finished.id, status: finished.status };
  }

  async runCodegen(input: {
    projectId: string;
    moduleName: string;
    pipelineRunId?: string;
  }): Promise<{ jobId: string; status: string }> {
    await this.touchPipeline(input.pipelineRunId, { currentStage: "codegen" });
    const job = await this.deps.codegenService.startCodeGeneration(
      input.projectId,
      input.moduleName,
      true,
    );
    const finished = await waitForJob(this.deps.piJobs, job.id);
    if (finished.status !== "completed") {
      throw new AppError(
        "PIPELINE_CODEGEN_FAILED",
        finished.error ?? "Codegen failed",
        500,
      );
    }
    return { jobId: finished.id, status: finished.status };
  }

  async runPytest(input: {
    projectId: string;
    pipelineRunId?: string;
    preset?: "ci" | "debug";
    nodeIds?: string[];
    previousRunId?: string;
  }): Promise<{ runId: string; status: string; passed: number; failed: number }> {
    await this.touchPipeline(input.pipelineRunId, { currentStage: "run" });
    const run = await this.deps.runService.startRun(input.projectId, {
      preset: input.preset ?? "ci",
      nodeIds: input.nodeIds,
      previousRunId: input.previousRunId,
      rerunFailedOnly: Boolean(input.previousRunId),
      triggerSource: "temporal",
    });
    const finished = await waitForRun(this.deps.runService, input.projectId, run.id);
    await this.touchPipeline(input.pipelineRunId, { runId: finished.id });
    return {
      runId: finished.id,
      status: finished.status,
      passed: finished.passed,
      failed: finished.failed,
    };
  }

  async runFixAnalyze(input: {
    projectId: string;
    runId: string;
    pipelineRunId?: string;
    fixIteration?: number;
  }): Promise<{ jobId: string; suggestionId: string }> {
    await this.touchPipeline(input.pipelineRunId, {
      currentStage: "fix_analyze",
      fixIteration: input.fixIteration,
    });
    const job = await this.deps.fixService.startFixAnalysis(input.projectId, input.runId);
    const finished = await waitForJob(this.deps.piJobs, job.id);
    if (finished.status !== "completed") {
      throw new AppError(
        "PIPELINE_FIX_ANALYZE_FAILED",
        finished.error ?? "Fix analysis failed",
        500,
      );
    }
    const suggestionId =
      typeof finished.result?.suggestionId === "string" ? finished.result.suggestionId : "";
    if (!suggestionId) {
      throw new AppError("PIPELINE_FIX_NO_SUGGESTION", "Fix analysis produced no suggestion", 500);
    }
    return { jobId: finished.id, suggestionId };
  }

  async runFixApply(input: {
    projectId: string;
    suggestionId: string;
    pipelineRunId?: string;
  }): Promise<{ appliedFiles: string[]; skippedFiles: string[] }> {
    await this.touchPipeline(input.pipelineRunId, { currentStage: "fix_apply" });
    const data = await this.deps.fixService.applyAllFixPatches(
      input.projectId,
      input.suggestionId,
    );
    return { appliedFiles: data.appliedFiles, skippedFiles: data.skippedFiles };
  }

  async runFixVerify(input: {
    projectId: string;
    runId: string;
    pipelineRunId?: string;
  }): Promise<{ runId: string; status: string; passed: number; failed: number }> {
    await this.touchPipeline(input.pipelineRunId, { currentStage: "fix_verify" });
    const { verifyRunId } = await this.deps.fixService.verifyFix(input.projectId, input.runId);
    const finished = await waitForRun(this.deps.runService, input.projectId, verifyRunId);
    await this.touchPipeline(input.pipelineRunId, { runId: finished.id });
    return {
      runId: finished.id,
      status: finished.status,
      passed: finished.passed,
      failed: finished.failed,
    };
  }
}
