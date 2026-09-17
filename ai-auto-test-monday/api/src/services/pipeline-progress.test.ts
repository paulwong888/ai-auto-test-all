import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coerceActiveRunProgress,
  mergeExecuteProgress,
} from "./pipeline-progress.js";
import type { PipelineProgress } from "@monday/agent-core/workflow";

const baseRun = {
  project_id: "demo",
  id: "run-1",
  artifact_root: "/data/artifacts/demo/run-1",
  status: "running",
  execution_status: "pending",
  finished_at: null,
};

describe("mergeExecuteProgress", () => {
  it("returns mainProgress failed when execution_status is pending", () => {
    const mainProgress: PipelineProgress = {
      projectId: "demo",
      runId: "run-1",
      status: "failed",
      currentAgent: null,
      completedAgents: [
        "scriptAnalyst",
        "stageManager",
        "blockingCoach",
        "setDesigner",
      ],
      artifactRoot: "/data/artifacts/demo/run-1",
      error: "Choreographer: LLM journey generation failed",
      executeAfterGenerate: true,
    };

    const merged = mergeExecuteProgress(mainProgress, null, baseRun);
    assert.equal(merged?.status, "failed");
    assert.equal(merged?.currentAgent, null);
    assert.notEqual(merged?.currentAgent, "continuityLead");
    assert.match(String(merged?.error), /Choreographer/);
  });

  it("returns choreographer running during generation with execute pending", () => {
    const mainProgress: PipelineProgress = {
      projectId: "demo",
      runId: "run-1",
      status: "running",
      currentAgent: "choreographer",
      completedAgents: [
        "scriptAnalyst",
        "stageManager",
        "blockingCoach",
        "setDesigner",
      ],
      artifactRoot: "/data/artifacts/demo/run-1",
      executeAfterGenerate: true,
    };

    const merged = mergeExecuteProgress(mainProgress, null, baseRun);
    assert.equal(merged?.status, "running");
    assert.equal(merged?.currentAgent, "choreographer");
  });

  it("synthesizes continuityLead only after generation completed", () => {
    const run = {
      ...baseRun,
      status: "completed",
      finished_at: "2026-09-14T08:00:00.000Z",
    };

    const merged = mergeExecuteProgress(null, null, run);
    assert.equal(merged?.status, "running");
    assert.equal(merged?.currentAgent, "continuityLead");
    assert.ok(merged?.completedAgents.includes("assistantDirector"));
  });

  it("prefers failed when exec overlay completed but execution_status is failed", () => {
    const execProgress: PipelineProgress = {
      projectId: "demo",
      runId: "run-1",
      status: "completed",
      currentAgent: null,
      completedAgents: [
        "scriptAnalyst",
        "stageManager",
        "blockingCoach",
        "setDesigner",
        "choreographer",
        "assistantDirector",
        "continuityLead",
      ],
      artifactRoot: "/data/artifacts/demo/run-1",
      executeAfterGenerate: true,
    };

    const run = {
      ...baseRun,
      status: "running",
      execution_status: "failed",
    };

    const merged = mergeExecuteProgress(null, execProgress, run);
    assert.equal(merged?.status, "failed");
    assert.equal(merged?.currentAgent, null);
  });

  it("coerces running progress when DB run is active but workflow query is completed", () => {
    const stale: PipelineProgress = {
      projectId: "demo",
      runId: "run-1",
      status: "completed",
      currentAgent: null,
      completedAgents: [
        "scriptAnalyst",
        "stageManager",
        "blockingCoach",
        "setDesigner",
        "choreographer",
        "assistantDirector",
        "continuityLead",
      ],
      artifactRoot: "/data/artifacts/demo/run-1",
      executeAfterGenerate: true,
    };

    const run = {
      ...baseRun,
      status: "running",
      current_agent: "assistantDirector",
      execution_status: null,
      finished_at: null,
    };

    const coerced = coerceActiveRunProgress(run, stale);
    assert.equal(coerced?.status, "running");
    assert.equal(coerced?.currentAgent, "assistantDirector");
    assert.ok(!coerced?.completedAgents.includes("assistantDirector"));
  });

  it("coerces continuityLead running when execution_status is running", () => {
    const run = {
      ...baseRun,
      status: "completed",
      execution_status: "running",
      finished_at: "2026-09-14T09:00:00.000Z",
    };

    const coerced = coerceActiveRunProgress(run, null);
    assert.equal(coerced?.status, "running");
    assert.equal(coerced?.currentAgent, "continuityLead");
  });

  it("returns failed when execution_status is failed and mainProgress completed", () => {
    const mainProgress: PipelineProgress = {
      projectId: "demo",
      runId: "run-1",
      status: "completed",
      currentAgent: null,
      completedAgents: [
        "scriptAnalyst",
        "stageManager",
        "blockingCoach",
        "setDesigner",
        "choreographer",
        "assistantDirector",
        "continuityLead",
      ],
      artifactRoot: "/data/artifacts/demo/run-1",
      executeAfterGenerate: true,
    };

    const run = {
      ...baseRun,
      status: "completed",
      execution_status: "failed",
      finished_at: "2026-09-14T09:33:00.000Z",
    };

    const merged = mergeExecuteProgress(mainProgress, null, run);
    assert.equal(merged?.status, "failed");
    assert.equal(merged?.currentAgent, null);
    assert.ok(merged?.completedAgents.includes("continuityLead"));
  });
});
