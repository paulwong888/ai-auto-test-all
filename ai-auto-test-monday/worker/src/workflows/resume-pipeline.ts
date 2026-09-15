import {
  defineQuery,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type { AgentId, PipelineInput, PipelineProgress } from "@monday/agent-core/workflow";
import {
  AGENT_IDS,
  PROGRESS_QUERY,
} from "@monday/agent-core/workflow";
import type * as activities from "../activities/index.js";

export const getResumeProgress = defineQuery<PipelineProgress>(PROGRESS_QUERY);

const scriptAnalystActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
  cancellationType: "TRY_CANCEL",
});

const stageManagerActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
  cancellationType: "TRY_CANCEL",
});

const blockingCoachActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
  cancellationType: "TRY_CANCEL",
});

const setDesignerActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 2 },
  cancellationType: "TRY_CANCEL",
});

const choreographerActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 1 },
  cancellationType: "TRY_CANCEL",
});

const assistantDirectorActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "20 minutes",
  retry: { maximumAttempts: 2 },
  cancellationType: "TRY_CANCEL",
});

const continuityLeadActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: { maximumAttempts: 1 },
  cancellationType: "TRY_CANCEL",
});

const ACTIVITY_MAP = {
  scriptAnalyst: scriptAnalystActivities.scriptAnalyst,
  stageManager: stageManagerActivities.stageManager,
  blockingCoach: blockingCoachActivities.blockingCoach,
  setDesigner: setDesignerActivities.setDesigner,
  choreographer: choreographerActivities.choreographer,
  assistantDirector: assistantDirectorActivities.assistantDirector,
  continuityLead: continuityLeadActivities.continuityLead,
} as const;

function agentsBefore(startFromAgent: AgentId): AgentId[] {
  const idx = AGENT_IDS.indexOf(startFromAgent);
  return idx <= 0 ? [] : AGENT_IDS.slice(0, idx);
}

export async function resumePipelineWorkflow(
  input: PipelineInput,
): Promise<PipelineProgress> {
  const startFromAgent = input.startFromAgent ?? "scriptAnalyst";
  const executeAfterGenerate = input.executeAfterGenerate !== false;
  const startIdx = AGENT_IDS.indexOf(startFromAgent);
  const agentsToRun = AGENT_IDS.slice(startIdx);

  const progress: PipelineProgress = {
    projectId: input.projectId,
    runId: input.runId,
    status: "running",
    currentAgent: null,
    completedAgents: agentsBefore(startFromAgent),
    artifactRoot: input.artifactRoot,
    executeAfterGenerate,
    skippedAgents: [],
  };

  setHandler(getResumeProgress, () => progress);

  try {
    for (const agentId of agentsToRun) {
      if (
        agentId === "continuityLead" &&
        !executeAfterGenerate &&
        startFromAgent !== "continuityLead"
      ) {
        progress.skippedAgents = ["continuityLead"];
        break;
      }

      progress.currentAgent = agentId;
      await ACTIVITY_MAP[agentId](input);
      progress.completedAgents.push(agentId);
    }

    progress.currentAgent = null;
    progress.status = "completed";
    return progress;
  } catch (err) {
    if (err instanceof Error && err.message.includes("cancelled")) {
      progress.status = "cancelled";
      progress.error = err.message;
    } else {
      progress.status = "failed";
      progress.error = err instanceof Error ? err.message : String(err);
    }
    progress.currentAgent = null;
    throw err;
  }
}
