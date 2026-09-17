import type { AgentId } from "@monday/agent-core/workflow";
import type { ArtifactStore } from "@monday/agent-core";

const DOWNSTREAM_FILES: Partial<Record<AgentId, string[]>> = {
  scriptAnalyst: [
    "testid-injections.json",
    "locator-catalog.json",
    "journeys.json",
    "execution-report.json",
    "apply-report.json",
  ],
  stageManager: [
    "locator-catalog.json",
    "journeys.json",
    "execution-report.json",
  ],
  blockingCoach: ["journeys.json", "execution-report.json"],
  setDesigner: ["journeys.json", "execution-report.json"],
  choreographer: ["execution-report.json"],
  assistantDirector: ["execution-report.json"],
  continuityLead: ["execution-report.json"],
};

const DOWNSTREAM_DIRS: Partial<Record<AgentId, string[]>> = {
  scriptAnalyst: ["poms", "tests"],
  stageManager: ["poms", "tests"],
  blockingCoach: ["poms", "tests"],
  setDesigner: ["poms", "tests"],
  choreographer: ["tests"],
  assistantDirector: ["tests"],
};

export function downstreamDeletesExecutionReport(fromAgent: AgentId): boolean {
  return (DOWNSTREAM_FILES[fromAgent] ?? []).includes("execution-report.json");
}

export async function cleanupDownstreamArtifacts(
  store: ArtifactStore,
  prefix: string,
  fromAgent: AgentId,
): Promise<void> {
  for (const file of DOWNSTREAM_FILES[fromAgent] ?? []) {
    await store.deleteObject(prefix, file);
  }

  for (const dir of DOWNSTREAM_DIRS[fromAgent] ?? []) {
    await store.deletePrefix(prefix, dir);
  }

  if (fromAgent === "assistantDirector") {
    await store.deletePrefix(prefix, "tests");
  }
}
