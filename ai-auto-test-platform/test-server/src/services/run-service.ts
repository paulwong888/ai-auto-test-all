import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { buildPiRunRpcArgs } from "../config.js";
import {
  GherkinStepTracker,
  applyTrackerUpdates,
  formatToolLog,
} from "../pi/gherkin-step-tracker.js";
import type { MilestoneKind } from "../pi/gherkin-step-tracker.js";
import { PiRpcClient } from "../pi/rpc-client.js";
import type { AuditProgressEvent, FeatureItem, GherkinPhase, StepStatus, WsMessage } from "../pi/types.js";
import { flattenGherkinSteps } from "../pi/types.js";
import { BashStreamDeduper, buildRunPrompt, specRelPath } from "./run-prompt.js";
import { isPlaywrightSpecCommand } from "./playwright-runner.js";
import { FeaturesRepository } from "../repositories/features-repository.js";
import type { ProjectService } from "./project-service.js";
import { ProjectEnvService } from "./project-env-service.js";
import { loadRunPromptContext } from "./run-prompt-context.js";
import {
  extractFailureSummary,
  saveRunHistoryEntry,
  truncateText,
} from "./run-history-service.js";
import { wsHub } from "../ws/ws-hub.js";

export interface RunOptions {
  featureId: string;
  projectId?: string;
  repoPath?: string;
  targetUrl?: string;
}

export interface ActiveRunLog {
  stream: "stdout" | "stderr" | "ai" | "tool";
  text: string;
}

export interface ActiveRunSnapshot {
  runId: string;
  featureId: string;
  title: string;
  startedAt: string;
  logs: ActiveRunLog[];
}

export class RunService {
  private running = false;
  private cancelled = false;
  private activeClient: PiRpcClient | null = null;
  private activeSnapshot: ActiveRunSnapshot | null = null;
  private readonly envService: ProjectEnvService;
  private readonly featuresRepo: FeaturesRepository;

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
    featuresRepo?: FeaturesRepository,
  ) {
    this.envService = new ProjectEnvService(config);
    this.featuresRepo = featuresRepo ?? new FeaturesRepository();
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): { running: boolean; activeRun: ActiveRunSnapshot | null } {
    return {
      running: this.running,
      activeRun: this.activeSnapshot
        ? { ...this.activeSnapshot, logs: [...this.activeSnapshot.logs] }
        : null,
    };
  }

  cancelRun(): boolean {
    if (!this.running) return false;
    this.cancelled = true;
    this.activeClient?.stop();
    return true;
  }

  private appendRunLog(stream: ActiveRunLog["stream"], text: string): void {
    if (!this.activeSnapshot || !text) return;
    this.activeSnapshot.logs.push({ stream, text });
    if (this.activeSnapshot.logs.length > 300) {
      this.activeSnapshot.logs.splice(0, this.activeSnapshot.logs.length - 300);
    }
  }

  private clearActiveRun(): void {
    this.activeClient = null;
    this.activeSnapshot = null;
    this.cancelled = false;
  }

  async runScenario(options: RunOptions): Promise<{ runId: string }> {
    if (this.running) {
      throw new Error("已有劇本正在執行，請等待完成");
    }

    let repoPath: string;
    let targetUrl: string;
    let projectId = options.projectId;
    if (options.projectId) {
      const project = await this.projectService.resolve(options.projectId);
      repoPath = project.repoPath;
      targetUrl = project.targetUrl;
    } else {
      repoPath = path.resolve(options.repoPath ?? this.config.defaultSandboxRepo);
      targetUrl = options.targetUrl ?? this.config.defaultTargetAppUrl;
      projectId = (await this.projectService.resolveIdByRepoPath(repoPath)) ?? undefined;
    }

    const envCheck = await this.envService.ensureTestEnv(repoPath, targetUrl);
    if (!envCheck.ok) {
      throw new Error(envCheck.message);
    }

    if (!projectId) {
      throw new Error("projectId required to load features from database");
    }

    const doc = await this.featuresRepo.getDocument(projectId);
    if (!doc) {
      throw new Error("No features found for project. Run audit first.");
    }
    const feature = doc.features.find((f) => f.id === options.featureId);
    if (!feature) {
      throw new Error(`Feature not found: ${options.featureId}`);
    }

    const runId = randomUUID();
    const steps = flattenGherkinSteps(feature.gherkin);
    const tracker = new GherkinStepTracker(steps);

    this.running = true;
    this.activeSnapshot = {
      runId,
      featureId: feature.id,
      title: feature.title,
      startedAt: new Date().toISOString(),
      logs: [],
    };
    this.broadcast({
      type: "run_started",
      runId,
      featureId: feature.id,
      title: feature.title,
      steps,
    });

    void this.executeRun(runId, repoPath, targetUrl, feature, tracker, projectId).finally(() => {
      this.running = false;
      this.clearActiveRun();
    });

    return { runId };
  }

  private async executeRun(
    runId: string,
    repoPath: string,
    targetUrl: string,
    feature: FeatureItem,
    tracker: GherkinStepTracker,
    projectId?: string,
  ): Promise<void> {
    const specFile = specRelPath(feature.id);
    const resolvedProjectId =
      projectId ?? (await this.projectService.resolveIdByRepoPath(repoPath)) ?? undefined;
    let lastPlaywrightOk = false;
    let stoppedByCap = false;
    const bashDeduper = new BashStreamDeduper();
    const playwrightOutputChunks: string[] = [];
    let collectingPlaywrightOutput = false;

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
      this.appendRunLog(stream, text);
      this.broadcast({ type: "log", runId, stream, text });
    };

    const apply = (updates: ReturnType<GherkinStepTracker["onRunStart"]>) => {
      applyTrackerUpdates(updates, emitStep, emitMilestone);
    };

    const isTargetPlaywrightCmd = (cmd: string): boolean =>
      isPlaywrightSpecCommand(cmd, specFile);

    const appendPlaywrightOutput = (text: string): void => {
      if (!collectingPlaywrightOutput || !text) return;
      playwrightOutputChunks.push(text);
    };

    const onProgress = (event: AuditProgressEvent) => {
      switch (event.kind) {
        case "text_delta":
          emitLog("ai", event.delta);
          apply(tracker.onTextDelta(event.delta));
          break;
        case "tool_start":
          emitLog("tool", formatToolLog(event));
          apply(tracker.onToolStart(event.toolName, event.args));
          if (event.toolName === "bash") {
            const cmd = String(event.args.command ?? "");
            if (isTargetPlaywrightCmd(cmd)) {
              collectingPlaywrightOutput = true;
              playwrightOutputChunks.length = 0;
              const max = this.config.runMaxPlaywrightAttempts;
              if (tracker.getPlaywrightAttempt() > max) {
                stoppedByCap = true;
                emitMilestone(
                  "then_fail",
                  `已达 Playwright 上限 ${max} 次，停止自愈`,
                );
                this.activeClient?.stop();
              }
            }
          }
          break;
        case "tool_end":
          emitLog("tool", formatToolLog(event));
          if (event.toolName === "bash") {
            const cmd = String(event.args.command ?? "");
            if (isTargetPlaywrightCmd(cmd)) {
              lastPlaywrightOk = !event.isError;
              collectingPlaywrightOutput = false;
            }
          }
          apply(tracker.onToolEnd(event.toolName, event.isError, event.args));
          break;
        case "agent_event": {
          const ev = event.event;
          if (ev.type === "bash_execution_update") {
            const delta = String((ev as { delta: string }).delta);
            emitLog("stdout", delta);
            appendPlaywrightOutput(delta);
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
                appendPlaywrightOutput(delta);
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
      rpcArgs: buildPiRunRpcArgs(this.config),
      onProgress,
    });
    this.activeClient = client;

    const persistRunHistory = async (success: boolean): Promise<void> => {
      if (!resolvedProjectId) return;
      const failureSummary = success ? undefined : extractFailureSummary(playwrightOutputChunks);
      const lastPlaywrightExitError =
        !success && playwrightOutputChunks.length > 0
          ? truncateText(playwrightOutputChunks.join("\n"), 500)
          : undefined;
      await saveRunHistoryEntry(resolvedProjectId, feature.id, {
        lastSuccess: success,
        lastRunAt: new Date().toISOString(),
        playwrightAttempts: tracker.getPlaywrightAttempt(),
        ...(failureSummary ? { failureSummary } : {}),
        ...(lastPlaywrightExitError ? { lastPlaywrightExitError } : {}),
      }).catch((err) => {
        emitLog(
          "stderr",
          `[run] 无法写入 run-history: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    };

    try {
      await client.start();
      emitLog("stdout", `[run] Pi Agent 已啟動，目標 ${targetUrl}`);
      if (this.config.piRunSkillName) {
        emitLog("stdout", `[run] Skill: ${this.config.piRunSkillName}`);
      }
      emitLog("stdout", `[run] 單劇本模式 → ${specFile}`);
      apply(tracker.onRunStart());

      const ctx = await loadRunPromptContext(repoPath, feature.id, this.config, resolvedProjectId);
      await client.promptAndWait(
        buildRunPrompt(feature, repoPath, targetUrl, this.config, ctx),
        this.config.runTimeoutMs,
      );

      const success = !stoppedByCap && lastPlaywrightOk;
      apply(tracker.onSettled(success));

      const message = stoppedByCap
        ? `已达最大 Playwright 重试次数（${this.config.runMaxPlaywrightAttempts}）`
        : success
          ? "劇本執行成功，Then 斷言已通過"
          : "劇本執行失敗，請查看直播間日誌";

      this.broadcast({
        type: "run_finished",
        runId,
        success,
        message,
      });
      await persistRunHistory(success);
    } catch (err) {
      const message = this.cancelled
        ? "劇本執行已取消"
        : stoppedByCap
          ? `已达最大 Playwright 重试次数（${this.config.runMaxPlaywrightAttempts}）`
          : err instanceof Error
            ? err.message
            : String(err);
      emitLog("stderr", message);
      apply(tracker.onSettled(false));
      this.broadcast({ type: "run_finished", runId, success: false, message });
      await persistRunHistory(false);
    } finally {
      bashDeduper.reset();
      client.stop();
      this.activeClient = null;
    }
  }

  private broadcast(message: WsMessage): void {
    wsHub.broadcast(message);
  }
}
