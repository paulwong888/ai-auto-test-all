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
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
});

const stageManagerActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
});

const blockingCoachActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 2 },
});

const setDesignerActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 2 },
});

const choreographerActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 2 },
});

const assistantDirectorActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "20 minutes",
  retry: { maximumAttempts: 2 },
});

const ACTIVITY_MAP = {
  scriptAnalyst: scriptAnalystActivities.scriptAnalyst,
  stageManager: stageManagerActivities.stageManager,
  blockingCoach: blockingCoachActivities.blockingCoach,
  setDesigner: setDesignerActivities.setDesigner,
  choreographer: choreographerActivities.choreographer,
  assistantDirector: assistantDirectorActivities.assistantDirector,
} as const;

export async function directorPipelineWorkflow(
  input: PipelineInput,
): Promise<PipelineProgress> {
  const progress: PipelineProgress = {
    projectId: input.projectId,
    runId: input.runId,
    status: "running",
    currentAgent: null,
    completedAgents: [],
    artifactRoot: input.artifactRoot,
  };

  setHandler(getPipelineProgress, () => progress);

  try {
    for (const agentId of AGENT_IDS) {
      progress.currentAgent = agentId as AgentId;
      const run = ACTIVITY_MAP[agentId];
      await run(input);
      progress.completedAgents.push(agentId as AgentId);
    }
    progress.currentAgent = null;
    progress.status = "completed";
    return progress;
  } catch (err) {
    progress.status = "failed";
    progress.error = err instanceof Error ? err.message : String(err);
    progress.currentAgent = null;
    throw err;
  }
}
