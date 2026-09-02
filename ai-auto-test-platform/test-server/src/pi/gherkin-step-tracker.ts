import type { FlatGherkinStep, GherkinPhase, StepStatus } from "./types.js";

export interface StepUpdate {
  phase: GherkinPhase;
  index: number;
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

export interface MilestoneUpdate {
  kind: MilestoneKind;
  message: string;
  phase?: GherkinPhase;
  index?: number;
}

export type TrackerUpdate = { type: "step"; update: StepUpdate } | { type: "milestone"; update: MilestoneUpdate };

/**
 * 依序追蹤 Gherkin 步驟，並將 Pi 工具事件對齊到 When 失敗 → 自愈 → 重跑 → Then 斷言流程。
 */
export class GherkinStepTracker {
  readonly steps: FlatGherkinStep[];
  private cursor = 0;
  private healing = false;
  private playwrightAttempt = 0;
  private finished = false;
  private failedAtCursor: number | null = null;
  private thenCursor = 0;

  constructor(steps: FlatGherkinStep[]) {
    this.steps = steps.map((s) => ({ ...s }));
    this.thenCursor = this.steps.findIndex((s) => s.phase === "then");
    if (this.thenCursor < 0) this.thenCursor = this.steps.length;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  getPlaywrightAttempt(): number {
    return this.playwrightAttempt;
  }

  getHealing(): boolean {
    return this.healing;
  }

  onRunStart(): TrackerUpdate[] {
    if (this.steps.length === 0) return [];
    return this.setStepStatus(0, "running");
  }

  onTextDelta(delta: string): TrackerUpdate[] {
    const lower = delta.toLowerCase();
    const updates: TrackerUpdate[] = [];
    if (/自愈|修正|heal|fix|選擇器|选择器|selector/.test(delta)) {
      updates.push(...this.enterHealing("healing_start", "🔧 When 步驟失敗，Pi 正在閱讀原始碼並修正選擇器…"));
    }
    if (/重跑|重新執行|retry|re-run/.test(lower)) {
      updates.push(...this.emitMilestone("healing_retry", "🔄 修正完成，重新執行 Playwright 測試…"));
    }
    return updates;
  }

  onToolStart(toolName: string, args: Record<string, unknown>): TrackerUpdate[] {
    const updates: TrackerUpdate[] = [];

    if (toolName === "read" && (this.healing || this.failedAtCursor !== null)) {
      updates.push(...this.enterHealing("healing_start", "🔧 正在閱讀原始碼以定位正確 DOM…"));
    }

    if ((toolName === "edit" || toolName === "write") && this.healing) {
      const path = String(args.path ?? args.file ?? "");
      if (path.includes("tests/e2e") || path.includes(".spec.")) {
        updates.push(...this.emitMilestone("healing_edit", "✏️ 正在修正測試腳本…"));
      }
    }

    if (toolName === "bash") {
      const cmd = String(args.command ?? "");
      if (!cmd.includes("playwright")) return updates;

      this.playwrightAttempt += 1;
      if (this.playwrightAttempt === 1) {
        updates.push(...this.advanceThroughGiven());
        updates.push(...this.setCurrentRunning());
      } else if (this.healing) {
        updates.push(...this.emitMilestone("healing_retry", "🔄 第 " + this.playwrightAttempt + " 次重跑 Playwright…"));
        if (this.failedAtCursor !== null) {
          updates.push(...this.setStepStatus(this.failedAtCursor, "running"));
        }
      }
    }

    return updates;
  }

  onToolEnd(toolName: string, isError: boolean, args: Record<string, unknown>): TrackerUpdate[] {
    if (toolName !== "bash") return [];
    const cmd = String(args.command ?? "");
    if (!cmd.includes("playwright")) return [];

    if (isError) {
      return this.onPlaywrightFailed();
    }

    this.healing = false;
    this.failedAtCursor = null;
    return this.onPlaywrightPassed();
  }

  onPlaywrightOutput(text: string): TrackerUpdate[] {
    const updates: TrackerUpdate[] = [];
    const lower = text.toLowerCase();

    if (/expect\(.*\).*failed|error: expect|toBeVisible.*failed|toHaveURL.*failed/i.test(text)) {
      const thenIdx = this.findCurrentThenIndex();
      if (thenIdx >= 0) {
        updates.push(...this.setStepStatus(thenIdx, "fail"));
        updates.push(
          ...this.emitMilestone("then_fail", `❌ Then 斷言失敗：${this.steps[thenIdx]!.text.slice(0, 80)}`, "then", this.steps[thenIdx]!.index),
        );
      }
    }

    if (/\d+\s+passed/i.test(lower) && !/failed/i.test(lower)) {
      updates.push(...this.markAllThenPassed());
    }

    return updates;
  }

  onSettled(success: boolean): TrackerUpdate[] {
    this.finished = true;
    const updates: TrackerUpdate[] = [];

    if (success) {
      updates.push(...this.markAllThenPassed());
      for (let i = 0; i < this.steps.length; i++) {
        if (this.steps[i]!.status !== "pass") {
          updates.push(...this.setStepStatus(i, "pass"));
        }
      }
      this.cursor = this.steps.length;
    } else {
      for (let i = this.cursor; i < this.steps.length; i++) {
        const s = this.steps[i]!;
        if (s.status === "pending" || s.status === "running" || s.status === "healing") {
          updates.push(...this.setStepStatus(i, "fail"));
        }
      }
    }

    return updates;
  }

  private onPlaywrightFailed(): TrackerUpdate[] {
    const updates: TrackerUpdate[] = [];
    const idx = this.findActiveStepIndex();
    if (idx < 0) return updates;

    const step = this.steps[idx]!;
    if (step.phase === "when" || step.phase === "and") {
      this.failedAtCursor = idx;
      this.healing = true;
      updates.push(...this.setStepStatus(idx, "fail"));
      updates.push(
        ...this.emitMilestone(
          "when_failed",
          `🔴 When 步驟失敗：${step.text.slice(0, 80)}`,
          step.phase,
          step.index,
        ),
      );
      updates.push(
        ...this.emitMilestone("healing_start", "🔧 啟動原始碼級自愈：讀取元件 → 修正選擇器 → 重跑"),
      );
    } else if (step.phase === "then") {
      updates.push(...this.setStepStatus(idx, "fail"));
      updates.push(
        ...this.emitMilestone("then_fail", `❌ Then 斷言未通過：${step.text.slice(0, 80)}`, "then", step.index),
      );
    } else {
      updates.push(...this.setStepStatus(idx, "fail"));
    }

    return updates;
  }

  private onPlaywrightPassed(): TrackerUpdate[] {
    const updates: TrackerUpdate[] = [];

    for (let i = 0; i < this.thenCursor; i++) {
      if (this.steps[i]!.status !== "pass") {
        updates.push(...this.setStepStatus(i, "pass"));
      }
    }

    updates.push(...this.emitMilestone("then_checking", "✅ Playwright 通過，正在驗證 Then 斷言…"));
    updates.push(...this.markAllThenPassed());

    return updates;
  }

  private markAllThenPassed(): TrackerUpdate[] {
    const updates: TrackerUpdate[] = [];
    for (let i = this.thenCursor; i < this.steps.length; i++) {
      if (this.steps[i]!.phase !== "then") continue;
      if (this.steps[i]!.status !== "pass") {
        updates.push(...this.setStepStatus(i, "pass"));
        updates.push(
          ...this.emitMilestone(
            "then_pass",
            `🟢 Then 斷言通過：${this.steps[i]!.text.slice(0, 80)}`,
            "then",
            this.steps[i]!.index,
          ),
        );
      }
    }
    return updates;
  }

  private advanceThroughGiven(): TrackerUpdate[] {
    const updates: TrackerUpdate[] = [];
    while (this.cursor < this.steps.length && this.steps[this.cursor]!.phase === "given") {
      updates.push(...this.setStepStatus(this.cursor, "pass"));
      this.cursor += 1;
    }
    return updates;
  }

  private setCurrentRunning(): TrackerUpdate[] {
    if (this.cursor >= this.steps.length) return [];
    return this.setStepStatus(this.cursor, "running");
  }

  private enterHealing(kind: MilestoneKind, message: string): TrackerUpdate[] {
    this.healing = true;
    const updates: TrackerUpdate[] = [...this.emitMilestone(kind, message)];
    const idx = this.failedAtCursor ?? this.findActiveStepIndex();
    if (idx >= 0 && (this.steps[idx]!.phase === "when" || this.steps[idx]!.phase === "and")) {
      updates.push(...this.setStepStatus(idx, "healing"));
    }
    return updates;
  }

  private findActiveStepIndex(): number {
    if (this.cursor < this.steps.length && this.steps[this.cursor]!.status === "running") {
      return this.cursor;
    }
    for (let i = this.cursor; i < this.steps.length; i++) {
      if (this.steps[i]!.status === "running" || this.steps[i]!.status === "healing") return i;
    }
    if (this.failedAtCursor !== null) return this.failedAtCursor;
    return this.cursor < this.steps.length ? this.cursor : -1;
  }

  private findCurrentThenIndex(): number {
    for (let i = this.thenCursor; i < this.steps.length; i++) {
      if (this.steps[i]!.phase === "then" && this.steps[i]!.status !== "pass") return i;
    }
    return -1;
  }

  private setStepStatus(index: number, status: StepStatus): TrackerUpdate[] {
    const step = this.steps[index];
    if (!step) return [];
    step.status = status;
    this.cursor = index;
    return [{ type: "step", update: { phase: step.phase, index: step.index, status } }];
  }

  private emitMilestone(
    kind: MilestoneKind,
    message: string,
    phase?: GherkinPhase,
    index?: number,
  ): TrackerUpdate[] {
    return [{ type: "milestone", update: { kind, message, phase, index } }];
  }
}

export function formatToolLog(
  event: { kind: "tool_start" | "tool_end"; toolName: string; args: Record<string, unknown>; isError?: boolean },
): string {
  if (event.kind === "tool_start") {
    return `▶ ${event.toolName} ${JSON.stringify(event.args)}`;
  }
  return `■ ${event.toolName} ${event.isError ? "FAILED" : "OK"}`;
}

export function applyTrackerUpdates(
  updates: TrackerUpdate[],
  emitStep: (phase: GherkinPhase, index: number, status: StepStatus) => void,
  emitMilestone: (kind: MilestoneKind, message: string, phase?: GherkinPhase, index?: number) => void,
): void {
  for (const u of updates) {
    if (u.type === "step") {
      emitStep(u.update.phase, u.update.index, u.update.status);
    } else {
      emitMilestone(u.update.kind, u.update.message, u.update.phase, u.update.index);
    }
  }
}
