import { AGENT_IDS } from "@monday/agent-core";
import type { AgentId, PipelineProgress } from "@monday/agent-core/workflow";

export const GENERATION_AGENTS = AGENT_IDS.filter(
  (id) => id !== "continuityLead",
) as AgentId[];

export function isGenerationFinished(run: Record<string, unknown>): boolean {
  return run.finished_at != null || run.status === "completed";
}

export function synthesizeGenerationCompleted(
  run: Record<string, unknown>,
): PipelineProgress {
  return {
    projectId: String(run.project_id),
    runId: String(run.id),
    status: "completed",
    currentAgent: null,
    completedAgents: [...GENERATION_AGENTS],
    artifactRoot: String(run.artifact_root),
    executeAfterGenerate: false,
    skippedAgents: run.execution_status == null ? ["continuityLead"] : [],
  };
}

export function enrichProgressFromRun(
  progress: PipelineProgress | null,
  run: Record<string, unknown>,
): PipelineProgress | null {
  if (progress) {
    if (
      progress.status === "completed" &&
      !progress.completedAgents.includes("continuityLead") &&
      run.execution_status == null
    ) {
      progress.executeAfterGenerate = progress.executeAfterGenerate ?? false;
      progress.skippedAgents = progress.skippedAgents?.length
        ? progress.skippedAgents
        : ["continuityLead"];
    }
    return progress;
  }

  if (run.status === "completed" && run.execution_status == null) {
    return synthesizeGenerationCompleted(run);
  }

  return null;
}

function synthesizeExecutionPending(
  run: Record<string, unknown>,
): PipelineProgress {
  return {
    projectId: String(run.project_id),
    runId: String(run.id),
    status: "running",
    currentAgent: "continuityLead",
    completedAgents: [...GENERATION_AGENTS],
    artifactRoot: String(run.artifact_root),
    executeAfterGenerate: true,
    skippedAgents: [],
  };
}

function synthesizeExecutionTerminal(
  run: Record<string, unknown>,
  executionStatus: "completed" | "failed",
): PipelineProgress {
  return {
    projectId: String(run.project_id),
    runId: String(run.id),
    status: executionStatus === "failed" ? "failed" : "completed",
    currentAgent: null,
    completedAgents: [...GENERATION_AGENTS, "continuityLead"],
    artifactRoot: String(run.artifact_root),
    executeAfterGenerate: true,
    skippedAgents: [],
  };
}

export function mergeExecuteProgress(
  mainProgress: PipelineProgress | null,
  execProgress: PipelineProgress | null,
  run: Record<string, unknown>,
): PipelineProgress | null {
  const executionStatus = run.execution_status as string | null | undefined;
  if (!executionStatus) {
    return enrichProgressFromRun(mainProgress, run);
  }

  const base =
    mainProgress ??
    (isGenerationFinished(run) ? synthesizeGenerationCompleted(run) : null);

  if (execProgress) {
    const completedAgents = execProgress.completedAgents.includes(
      "continuityLead",
    )
      ? execProgress.completedAgents
      : ([
          ...new Set([
            ...(base?.completedAgents ?? GENERATION_AGENTS),
            ...execProgress.completedAgents,
          ]),
        ] as AgentId[]);

    return {
      ...execProgress,
      projectId: String(run.project_id),
      runId: String(run.id),
      artifactRoot: String(run.artifact_root),
      completedAgents,
      skippedAgents: [],
      executeAfterGenerate: true,
    };
  }

  if (mainProgress) {
    const merged: PipelineProgress = {
      ...mainProgress,
      projectId: String(run.project_id),
      runId: String(run.id),
      artifactRoot: String(run.artifact_root),
      executeAfterGenerate: true,
      skippedAgents: mainProgress.skippedAgents ?? [],
    };

    if (executionStatus === "failed") {
      const completedAgents = merged.completedAgents.includes("continuityLead")
        ? merged.completedAgents
        : ([...merged.completedAgents, "continuityLead"] as AgentId[]);
      return {
        ...merged,
        status: "failed",
        currentAgent: null,
        completedAgents,
      };
    }

    if (executionStatus === "completed") {
      const completedAgents = merged.completedAgents.includes("continuityLead")
        ? merged.completedAgents
        : ([...merged.completedAgents, "continuityLead"] as AgentId[]);
      return {
        ...merged,
        status: "completed",
        currentAgent: null,
        completedAgents,
      };
    }

    if (executionStatus === "running") {
      return {
        ...merged,
        status: "running",
        currentAgent: merged.currentAgent ?? "continuityLead",
        completedAgents:
          merged.completedAgents.length >= GENERATION_AGENTS.length
            ? merged.completedAgents
            : [...GENERATION_AGENTS],
      };
    }

    return merged;
  }

  if (
    executionStatus === "pending" &&
    isGenerationFinished(run)
  ) {
    return synthesizeExecutionPending(run);
  }

  if (executionStatus === "completed" || executionStatus === "failed") {
    return synthesizeExecutionTerminal(
      run,
      executionStatus as "completed" | "failed",
    );
  }

  return null;
}
