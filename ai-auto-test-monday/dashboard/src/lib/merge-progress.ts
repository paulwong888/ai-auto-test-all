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
  apiAgent: string | null,
  wsAgent: string | null,
  completedAgents: string[],
): string | null {
  let current = apiAgent ?? wsAgent;
  if (apiAgent && wsAgent) {
    const apiIdx = agentIndex(apiAgent);
    const wsIdx = agentIndex(wsAgent);
    current = wsIdx >= apiIdx ? wsAgent : apiAgent;
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

/** Merge API (authoritative) progress with WS incremental events. */
export function mergePipelineProgress(
  api: PipelineProgressView | null,
  ws: PipelineProgressView | null,
): PipelineProgressView | null {
  if (!api && !ws) return null;
  if (!api) return ws;
  if (!ws) return api;

  const completedAgents = [
    ...new Set([...api.completedAgents, ...ws.completedAgents]),
  ];

  const currentAgent = resolveCurrentAgent(
    api.currentAgent,
    ws.currentAgent,
    completedAgents,
  );

  let status = api.status;
  if (TERMINAL_STATUSES.has(api.status)) {
    status = api.status;
  } else if (TERMINAL_STATUSES.has(ws.status)) {
    status = ws.status;
  } else if (api.status === "running" || ws.status === "running") {
    status = "running";
  }

  return {
    ...api,
    status,
    currentAgent,
    completedAgents,
    artifactRoot: ws.artifactRoot ?? api.artifactRoot,
    error: ws.error ?? api.error,
    executeAfterGenerate: ws.executeAfterGenerate ?? api.executeAfterGenerate,
    skippedAgents: ws.skippedAgents?.length
      ? ws.skippedAgents
      : api.skippedAgents,
  };
}
