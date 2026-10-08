import { defineQuery, proxyActivities, setHandler } from "@temporalio/workflow";
import type {
  PlatformPipelineInput,
  PlatformProgress,
} from "../shared/workflow-types.js";
import { PLATFORM_PROGRESS_QUERY } from "../shared/workflow-types.js";
import type * as activities from "../activities/index.js";

export const getPlatformProgress = defineQuery<PlatformProgress>(PLATFORM_PROGRESS_QUERY);

const planActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: { maximumAttempts: 2 },
});

const codegenActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: { maximumAttempts: 2 },
});

const runActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 minutes",
  retry: { maximumAttempts: 1 },
});

const fixAnalyzeActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: { maximumAttempts: 2 },
});

const fixApplyActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
});

const fixVerifyActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 minutes",
  retry: { maximumAttempts: 1 },
});

const finalizeActs = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

export async function playwrightPlatformWorkflow(
  input: PlatformPipelineInput,
): Promise<PlatformProgress> {
  const progress: PlatformProgress = {
    pipelineRunId: input.pipelineRunId,
    projectId: input.projectId,
    stage: "starting",
    status: "running",
    fixIteration: 0,
  };
  setHandler(getPlatformProgress, () => progress);

  try {
    if (!input.skipPlan) {
      progress.stage = "plan";
      const plan = await planActs.planGenerate(input);
      progress.jobId = plan.jobId;
    }

    if (!input.skipCodegen) {
      progress.stage = "codegen";
      const codegen = await codegenActs.codegenGenerate(input);
      progress.jobId = codegen.jobId;
    }

    progress.stage = "run";
    let runResult = await runActs.pytestRun({
      projectId: input.projectId,
      pipelineRunId: input.pipelineRunId,
      preset: input.runPreset,
      nodeIds: input.nodeIds,
    });
    progress.runId = runResult.runId;

    const autoFix = input.autoFix !== false;
    const maxFix = input.maxFixIterations ?? 3;
    let fixIteration = 0;
    let originalRunId = runResult.runId;

    while (autoFix && runResult.status !== "passed" && fixIteration < maxFix) {
      fixIteration += 1;
      progress.fixIteration = fixIteration;
      progress.stage = "fix_analyze";
      const fix = await fixAnalyzeActs.fixAnalyze({
        projectId: input.projectId,
        pipelineRunId: input.pipelineRunId,
        runId: originalRunId,
        fixIteration,
      });
      progress.jobId = fix.jobId;

      progress.stage = "fix_apply";
      await fixApplyActs.fixApply({
        projectId: input.projectId,
        pipelineRunId: input.pipelineRunId,
        suggestionId: fix.suggestionId,
      });

      progress.stage = "fix_verify";
      runResult = await fixVerifyActs.fixVerifyRun({
        projectId: input.projectId,
        pipelineRunId: input.pipelineRunId,
        runId: originalRunId,
      });
      progress.runId = runResult.runId;
    }

    progress.stage = "done";
    progress.status = runResult.status === "passed" ? "passed" : "failed";
    if (progress.status === "failed") {
      progress.error = `pytest finished with status=${runResult.status}`;
    }

    await finalizeActs.finalizePipeline({
      pipelineRunId: input.pipelineRunId,
      status: progress.status,
      runId: progress.runId ?? null,
      fixIteration: progress.fixIteration ?? 0,
      error: progress.error ?? null,
    });

    return progress;
  } catch (err) {
    progress.stage = "done";
    progress.status = "failed";
    progress.error = err instanceof Error ? err.message : String(err);
    await finalizeActs.finalizePipeline({
      pipelineRunId: input.pipelineRunId,
      status: "failed",
      runId: progress.runId ?? null,
      fixIteration: progress.fixIteration ?? 0,
      error: progress.error,
    });
    return progress;
  }
}
