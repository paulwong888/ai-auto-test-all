export type GherkinPhase = "given" | "when" | "then" | "and";
export type StepStatus = "pending" | "running" | "pass" | "fail" | "healing";

export interface GherkinSteps {
  scenario: string;
  given: string[];
  when: string[];
  then: string[];
  and?: string[];
}

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  sourceFile: string;
  route?: string;
  gherkin: GherkinSteps;
  gherkinText: string;
}

export interface FeaturesDocument {
  version: string;
  generatedAt: string;
  repoPath: string;
  features: FeatureItem[];
}

export interface FlatGherkinStep {
  phase: GherkinPhase;
  index: number;
  text: string;
  status: StepStatus;
}

export type MilestoneKind =
  | "when_failed"
  | "healing_start"
  | "healing_edit"
  | "healing_retry"
  | "then_checking"
  | "then_pass"
  | "then_fail";

export interface RunMilestone {
  id: string;
  kind: MilestoneKind;
  message: string;
  phase?: GherkinPhase;
  index?: number;
}

export type WsMessage =
  | { type: "run_started"; runId: string; featureId: string; title: string; steps: FlatGherkinStep[] }
  | { type: "step_update"; runId: string; phase: GherkinPhase; index: number; status: StepStatus }
  | {
      type: "milestone";
      runId: string;
      kind: MilestoneKind;
      message: string;
      phase?: GherkinPhase;
      index?: number;
    }
  | { type: "log"; runId: string; stream: "stdout" | "stderr" | "ai" | "tool"; text: string }
  | { type: "run_finished"; runId: string; success: boolean; message: string };

export const phaseLabel: Record<GherkinPhase, string> = {
  given: "假設",
  when: "當",
  then: "那麼",
  and: "並且",
};

export function stepKey(phase: GherkinPhase, index: number): string {
  return `${phase}:${index}`;
}

export function statusIcon(status: StepStatus): string {
  switch (status) {
    case "pass":
      return "🟢";
    case "fail":
      return "🔴";
    case "running":
      return "🟡";
    case "healing":
      return "🔧";
    default:
      return "⚪";
  }
}
