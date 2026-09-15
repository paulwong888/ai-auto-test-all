import {
  defineQuery,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type { AgentId, PipelineInput, PipelineProgress } from "@monday/agent-core/workflow";
import { EXECUTE_PROGRESS_QUERY } from "@monday/agent-core/workflow";
import type * as activities from "../activities/index.js";

export const getExecuteProgress = defineQuery<PipelineProgress>(
  EXECUTE_PROGRESS_QUERY,
);

const continuityLeadActivities = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: { maximumAttempts: 1 },
  cancellationType: "TRY_CANCEL",
});

const GENERATION_AGENTS: AgentId[] = [
  "scriptAnalyst",
  "stageManager",
  "blockingCoach",
  "setDesigner",
  "choreographer",
  "assistantDirector",
];

export async function continuityLeadOnlyWorkflow(
  input: PipelineInput,
): Promise<PipelineProgress> {
  const progress: PipelineProgress = {
    projectId: input.projectId,
    runId: input.runId,
    status: "running",
    currentAgent: "continuityLead",
    completedAgents: [...GENERATION_AGENTS],
    artifactRoot: input.artifactRoot,
    executeAfterGenerate: true,
    skippedAgents: [],
  };

  setHandler(getExecuteProgress, () => progress);

  try {
    const execResult = await continuityLeadActivities.continuityLead(input);
    progress.completedAgents.push("continuityLead");
    progress.currentAgent = null;
    if (execResult.failed > 0) {
      progress.status = "failed";
      progress.error = `${execResult.failed} journey(s) failed`;
    } else {
      progress.status = "completed";
    }
    return progress;
  } catch (err) {
    progress.status = "failed";
    progress.error = err instanceof Error ? err.message : String(err);
    progress.currentAgent = null;
    throw err;
  }
}
