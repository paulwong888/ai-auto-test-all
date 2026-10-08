import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "../api/client.js";
import type { StageStatus, WorkflowStage } from "../types/project.js";

export interface WorkflowState {
  projectId: string;
  workspacePath: string;
  stage: WorkflowStage;
  stageStatus: StageStatus;
  moduleName: string | null;
  artifactPaths: Record<string, unknown>;
  updatedAt: string | null;
}

const STAGE_ORDER: WorkflowStage[] = ["init", "recorded", "plan", "code", "run"];

export function stageIndex(stage: WorkflowStage): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx >= 0 ? idx : 0;
}

export function isTabEnabled(
  tab: "overview" | "record" | "plan" | "code" | "run",
  workflow: WorkflowState | null,
): boolean {
  if (!workflow) return tab === "overview";
  const minStage: Record<typeof tab, WorkflowStage> = {
    overview: "init",
    record: "init",
    plan: "recorded",
    code: "plan",
    run: "code",
  };
  if (stageIndex(workflow.stage) < stageIndex(minStage[tab])) {
    return false;
  }
  // Plan/Codegen 生成中：全局锁，仅保留概览
  if (workflow.stageStatus === "generating") {
    return tab === "overview";
  }
  // pytest running：已解锁 Tab 保持可点（长用例时导航栏不再整排消失）
  return true;
}

export function useWorkflow(projectId: string | undefined) {
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await fetchJson<WorkflowState>(`/api/projects/${projectId}/workflow`);
      setWorkflow(data);
    } catch {
      setWorkflow(null);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return { workflow, refreshWorkflow: refresh };
}
