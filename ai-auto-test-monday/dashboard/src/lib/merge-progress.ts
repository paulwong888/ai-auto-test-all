export interface PipelineProgressView {
  status: string;
  currentAgent: string | null;
  completedAgents: string[];
  artifactRoot?: string;
  error?: string;
  executeAfterGenerate?: boolean;
  skippedAgents?: string[];
}

const AGENT_ORDER = [
  "scriptAnalyst",
  "stageManager",
  "blockingCoach",
  "setDesigner",
  "choreographer",
  "assistantDirector",
  "continuityLead",
];

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function agentIndex(id: string): number {
  return AGENT_ORDER.indexOf(id);
}

function resolveCurrentAgent(
  liveAgent: string | null,
  staleAgent: string | null,
  completedAgents: string[],
): string | null {
  let current = liveAgent ?? staleAgent;
  if (liveAgent && staleAgent) {
    const liveIdx = agentIndex(liveAgent);
    const staleIdx = agentIndex(staleAgent);
    current = liveIdx >= staleIdx ? liveAgent : staleAgent;
  }

  if (current && completedAgents.includes(current)) {
    const idx = agentIndex(current);
    if (idx >= 0 && idx < AGENT_ORDER.length - 1) {
      return AGENT_ORDER[idx + 1] ?? null;
    }
    return null;
  }
  return current;
}

/** Merge live WS/snapshot progress with stale App-local state. Live wins when running. */
export function mergePipelineProgress(
  live: PipelineProgressView | null,
  stale: PipelineProgressView | null,
): PipelineProgressView | null {
  if (!live && !stale) return null;
  if (!live) return stale;
  if (!stale) return live;

  if (live.status === "running") {
    return {
      ...live,
      completedAgents: live.completedAgents,
      artifactRoot: live.artifactRoot ?? stale.artifactRoot,
      executeAfterGenerate:
        live.executeAfterGenerate ?? stale.executeAfterGenerate,
      skippedAgents: live.skippedAgents?.length
        ? live.skippedAgents
        : stale.skippedAgents,
    };
  }

  if (TERMINAL_STATUSES.has(live.status)) {
    const completedAgents = [
      ...new Set([...stale.completedAgents, ...live.completedAgents]),
    ];
    return {
      ...live,
      completedAgents,
      artifactRoot: live.artifactRoot ?? stale.artifactRoot,
      error: live.error ?? stale.error,
      executeAfterGenerate:
        live.executeAfterGenerate ?? stale.executeAfterGenerate,
      skippedAgents: live.skippedAgents?.length
        ? live.skippedAgents
        : stale.skippedAgents,
    };
  }

  const completedAgents = [
    ...new Set([...stale.completedAgents, ...live.completedAgents]),
  ];
  const currentAgent = resolveCurrentAgent(
    live.currentAgent,
    stale.currentAgent,
    completedAgents,
  );
  const status =
    live.status === "running" || stale.status === "running"
      ? "running"
      : live.status;

  return {
    ...live,
    status,
    currentAgent,
    completedAgents,
    artifactRoot: live.artifactRoot ?? stale.artifactRoot,
    error: live.error ?? stale.error,
    executeAfterGenerate: live.executeAfterGenerate ?? stale.executeAfterGenerate,
    skippedAgents: live.skippedAgents?.length
      ? live.skippedAgents
      : stale.skippedAgents,
  };
}
