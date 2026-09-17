import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergePipelineProgress, type PipelineProgressView } from "./merge-progress.js";

const ALL_AGENTS = [
  "scriptAnalyst",
  "stageManager",
  "blockingCoach",
  "setDesigner",
  "choreographer",
  "assistantDirector",
  "continuityLead",
];

function view(
  partial: Partial<PipelineProgressView> & Pick<PipelineProgressView, "status">,
): PipelineProgressView {
  return {
    currentAgent: null,
    completedAgents: [],
    ...partial,
  };
}

describe("mergePipelineProgress", () => {
  it("live running supersedes stale completed", () => {
    const stale = view({
      status: "completed",
      currentAgent: null,
      completedAgents: ALL_AGENTS,
    });
    const live = view({
      status: "running",
      currentAgent: "assistantDirector",
      completedAgents: [
        "scriptAnalyst",
        "stageManager",
        "blockingCoach",
        "setDesigner",
        "choreographer",
      ],
    });

    const merged = mergePipelineProgress(live, stale);
    assert.equal(merged?.status, "running");
    assert.equal(merged?.currentAgent, "assistantDirector");
    assert.deepEqual(merged?.completedAgents, live.completedAgents);
  });

  it("live completed unions completedAgents with stale", () => {
    const stale = view({
      status: "running",
      currentAgent: "continuityLead",
      completedAgents: ALL_AGENTS.slice(0, -1),
    });
    const live = view({
      status: "completed",
      currentAgent: null,
      completedAgents: ALL_AGENTS,
    });

    const merged = mergePipelineProgress(live, stale);
    assert.equal(merged?.status, "completed");
    assert.deepEqual(merged?.completedAgents, ALL_AGENTS);
  });

  it("resume snapshot keeps partial completedAgents over stale all-done", () => {
    const stale = view({
      status: "completed",
      completedAgents: ALL_AGENTS,
    });
    const live = view({
      status: "running",
      currentAgent: "choreographer",
      completedAgents: [
        "scriptAnalyst",
        "stageManager",
        "blockingCoach",
        "setDesigner",
      ],
    });

    const merged = mergePipelineProgress(live, stale);
    assert.equal(merged?.status, "running");
    assert.equal(merged?.currentAgent, "choreographer");
    assert.equal(merged?.completedAgents.length, 4);
    assert.ok(!merged?.completedAgents.includes("assistantDirector"));
  });
});
