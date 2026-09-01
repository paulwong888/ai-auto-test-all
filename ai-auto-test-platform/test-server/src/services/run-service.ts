import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import {
  GherkinStepTracker,
  applyTrackerUpdates,
  formatToolLog,
} from "../pi/gherkin-step-tracker.js";
import type { MilestoneKind } from "../pi/gherkin-step-tracker.js";
import { PiRpcClient } from "../pi/rpc-client.js";
import type { AuditProgressEvent, FeatureItem, GherkinPhase, StepStatus, WsMessage } from "../pi/types.js";
import { flattenGherkinSteps } from "../pi/types.js";
import { parseFeaturesDocument } from "../schemas/features.js";
import { BashStreamDeduper, buildRunPrompt, specRelPath } from "./run-prompt.js";
import type { ProjectService } from "./project-service.js";
import { wsHub } from "../ws/ws-hub.js";

export interface RunOptions {
  featureId: string;
  projectId?: string;
  repoPath?: string;
  targetUrl?: string;
}

export class RunService {
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  async runScenario(options: RunOptions): Promise<{ runId: string }> {
    if (this.running) {
      throw new Error("已有劇本正在執行，請等待完成");
    }

    let repoPath: string;
    let targetUrl: string;
    if (options.projectId) {
      const project = await this.projectService.resolve(options.projectId);
      repoPath = project.repoPath;
      targetUrl = project.targetUrl;
    } else {
      repoPath = path.resolve(options.repoPath ?? this.config.defaultSandboxRepo);
      targetUrl = options.targetUrl ?? this.config.defaultTargetAppUrl;
    }
    const featuresPath = path.join(repoPath, "FEATURES.json");

    const raw = await fs.readFile(featuresPath, "utf8");
    const doc = parseFeaturesDocument(JSON.parse(raw));
    const feature = doc.features.find((f) => f.id === options.featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${options.featureId}`);
    }

    const runId = randomUUID();
    const steps = flattenGherkinSteps(feature.gherkin);
    const tracker = new GherkinStepTracker(steps);

    this.running = true;
    this.broadcast({
      type: "run_started",
      runId,
      featureId: feature.id,
      title: feature.title,
      steps,
    });

    void this.executeRun(runId, repoPath, targetUrl, feature, tracker).finally(() => {
      this.running = false;
    });

    return { runId };
  }

  private async executeRun(
    runId: string,
    repoPath: string,
    targetUrl: string,
    feature: FeatureItem,
    tracker: GherkinStepTracker,
  ): Promise<void> {
    const specFile = specRelPath(feature.id);
    let lastPlaywrightOk = false;
    const bashDeduper = new BashStreamDeduper();

    const emitStep = (phase: GherkinPhase, index: number, status: StepStatus) => {
      this.broadcast({ type: "step_update", runId, phase, index, status });
    };

    const emitMilestone = (
      kind: MilestoneKind,
      message: string,
      phase?: GherkinPhase,
      index?: number,
    ) => {
      this.broadcast({ type: "milestone", runId, kind, message, phase, index });
      this.broadcast({ type: "log", runId, stream: "stdout", text: message });
    };

    const emitLog = (stream: "stdout" | "stderr" | "ai" | "tool", text: string) => {
      if (!text) return;
      this.broadcast({ type: "log", runId, stream, text });
    };

    const apply = (updates: ReturnType<GherkinStepTracker["onRunStart"]>) => {
      applyTrackerUpdates(updates, emitStep, emitMilestone);
    };

    const isTargetPlaywrightCmd = (cmd: string): boolean =>
      cmd.includes("playwright test") && cmd.includes(specFile);

    const onProgress = (event: AuditProgressEvent) => {
      switch (event.kind) {
        case "text_delta":
          emitLog("ai", event.delta);
          apply(tracker.onTextDelta(event.delta));
          break;
        case "tool_start":
          emitLog("tool", formatToolLog(event));
          apply(tracker.onToolStart(event.toolName, event.args));
          break;
        case "tool_end":
          emitLog("tool", formatToolLog(event));
          if (event.toolName === "bash") {
            const cmd = String(event.args.command ?? "");
            if (isTargetPlaywrightCmd(cmd)) {
              lastPlaywrightOk = !event.isError;
            }
          }
          apply(tracker.onToolEnd(event.toolName, event.isError, event.args));
          break;
        case "agent_event": {
          const ev = event.event;
          if (ev.type === "bash_execution_update") {
            const delta = String((ev as { delta: string }).delta);
            emitLog("stdout", delta);
            apply(tracker.onPlaywrightOutput(delta));
          }
          if (ev.type === "tool_execution_update") {
            const update = ev as {
              toolCallId: string;
              toolName: string;
              partialResult?: { content?: { text?: string }[] };
            };
            if (update.toolName === "bash") {
              const full = update.partialResult?.content?.map((c) => c.text ?? "").join("") ?? "";
              const delta = bashDeduper.push(update.toolCallId, full);
              if (delta) {
                emitLog("stdout", delta);
                apply(tracker.onPlaywrightOutput(delta));
              }
            }
          }
          if (ev.type === "tool_execution_end") {
            const end = ev as { toolCallId: string };
            bashDeduper.clear(end.toolCallId);
          }
          break;
        }
        case "error":
          emitLog("stderr", event.message);
          break;
        default:
          break;
      }
    };

    const client = new PiRpcClient({
      cwd: repoPath,
      piCliPath: this.config.piCliPath,
      rpcArgs: [...this.config.piRpcArgs],
      onProgress,
    });

    try {
      await client.start();
      emitLog("stdout", `[run] Pi Agent 已啟動，目標 ${targetUrl}`);
      emitLog("stdout", `[run] 單劇本模式 → ${specFile}`);
      apply(tracker.onRunStart());

      await client.promptAndWait(buildRunPrompt(feature, targetUrl), this.config.runTimeoutMs);

      const success = lastPlaywrightOk;
      apply(tracker.onSettled(success));

      this.broadcast({
        type: "run_finished",
        runId,
        success,
        message: success
          ? "劇本執行成功，Then 斷言已通過"
          : "劇本執行失敗，請查看直播間日誌",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitLog("stderr", message);
      apply(tracker.onSettled(false));
      this.broadcast({ type: "run_finished", runId, success: false, message });
    } finally {
      bashDeduper.reset();
      client.stop();
    }
  }

  private broadcast(message: WsMessage): void {
    wsHub.broadcast(message);
  }
}
