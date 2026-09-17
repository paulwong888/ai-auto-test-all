import { AGENT_IDS } from "@monday/agent-core";
import type { AgentId, PipelineProgress } from "@monday/agent-core/workflow";

export const GENERATION_AGENTS = AGENT_IDS.filter(
  (id) => id !== "continuityLead",
) as AgentId[];

export function agentsBefore(fromAgent: string | null): AgentId[] {
  if (!fromAgent) return [];
  const idx = AGENT_IDS.indexOf(fromAgent as AgentId);
  return idx <= 0 ? [] : AGENT_IDS.slice(0, idx);
}

/** When DB says the run is active but workflow query is stale/terminal, synthesize running progress. */
export function coerceActiveRunProgress(
  run: Record<string, unknown>,
  progress: PipelineProgress | null,
): PipelineProgress | null {
  const runStatus = String(run.status);
  const execStatus = run.execution_status as string | null | undefined;
  const dbRunActive = runStatus === "running";
  const execRunning = execStatus === "running";

  if (!dbRunActive && !execRunning) {
    return progress;
  }
  if (progress?.status === "running") {
    return progress;
  }

  const artifactRoot = String(run.artifact_root);
  const base = {
    projectId: String(run.project_id),
    runId: String(run.id),
    artifactRoot,
    executeAfterGenerate:
      progress?.executeAfterGenerate ??
      (run.execute_after_generate as boolean | null) ??
      true,
    skippedAgents: progress?.skippedAgents ?? [],
  };

  if (execRunning) {
    return {
      ...base,
      status: "running",
      currentAgent: "continuityLead",
      completedAgents: [...GENERATION_AGENTS],
    };
  }

  const currentAgent =
    (run.current_agent as string | null) ?? progress?.currentAgent ?? null;
  return {
    ...base,
    status: "running",
    currentAgent: currentAgent as AgentId | null,
    completedAgents:
      progress?.completedAgents?.length && progress.status !== "completed"
        ? progress.completedAgents
        : agentsBefore(currentAgent),
  };
}

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

    let status = execProgress.status;
    let error = execProgress.error;
    // Overlay workflow may report "completed" after the activity ran; DB
    // execution_status reflects whether journeys actually passed.
    if (executionStatus === "failed") {
      status = "failed";
      error = error ?? "execution failed";
    } else if (executionStatus === "completed") {
      status = "completed";
    }

    return {
      ...execProgress,
      projectId: String(run.project_id),
      runId: String(run.id),
      artifactRoot: String(run.artifact_root),
      completedAgents,
      skippedAgents: [],
      executeAfterGenerate: true,
      status,
      error,
      currentAgent:
        executionStatus === "running" ? execProgress.currentAgent : null,
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
