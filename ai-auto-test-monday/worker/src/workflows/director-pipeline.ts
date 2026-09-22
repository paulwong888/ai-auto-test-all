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

export const getPipelineProgress = defineQuery<PipelineProgress>(PROGRESS_QUERY);

const scriptAnalystActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 minutes",
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

const GENERATION_AGENTS = AGENT_IDS.filter((id) => id !== "continuityLead");

export async function directorPipelineWorkflow(
  input: PipelineInput,
): Promise<PipelineProgress> {
  const executeAfterGenerate = input.executeAfterGenerate !== false;
  const progress: PipelineProgress = {
    projectId: input.projectId,
    runId: input.runId,
    status: "running",
    currentAgent: null,
    completedAgents: [],
    artifactRoot: input.artifactRoot,
    executeAfterGenerate,
    skippedAgents: [],
  };

  setHandler(getPipelineProgress, () => progress);

  try {
    for (const agentId of GENERATION_AGENTS) {
      progress.currentAgent = agentId as AgentId;
      const run = ACTIVITY_MAP[agentId];
      await run(input);
      progress.completedAgents.push(agentId as AgentId);
    }

    if (executeAfterGenerate) {
      progress.currentAgent = "continuityLead";
      const execResult = await ACTIVITY_MAP.continuityLead(input);
      progress.completedAgents.push("continuityLead");
      progress.currentAgent = null;
      if (execResult.failed > 0) {
        progress.status = "failed";
        progress.error = `${execResult.failed} journey(s) failed`;
      } else {
        progress.status = "completed";
      }
      return progress;
    }

    progress.skippedAgents = ["continuityLead"];
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
