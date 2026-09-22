import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { JobRepository } from "../repositories/job-repository.js";
import { RunRepository, type RunRecord } from "../repositories/run-repository.js";
import { WorkflowStateRepository } from "../repositories/workflow-state-repository.js";
import { readNdjsonStream } from "../utils/ndjson-stream.js";
import { parsePytestSummaryFromLogs } from "../utils/pytest-summary.js";
import { wsHub } from "../ws/ws-hub.js";
import { buildPytestCommand, type PytestRunOptions } from "./pytest-runner.js";
import {
  effectiveVncPreview,
  effectiveVncPreviewFromRunOptions,
  resolveRunOptions,
  type RunRequestBody,
} from "./run-presets.js";
import { authDisabled } from "../middleware/auth.js";
import { createVncToken } from "../routes/vnc-tokens.js";
import type { ProjectService } from "./project-service.js";
import { parseFailedNodeIdsFromLogs } from "../utils/pytest-node-ids.js";

export type RunStartOptions = RunRequestBody;

export interface ActiveRunSnapshot {
  runId: string;
  projectId: string;
  jobId: string;
  startedAt: string;
}

export class RunService {
  private cancelled = false;
  private activeRunsByProject = new Map<string, ActiveRunSnapshot>();
  private abortController: AbortController | null = null;
  private readonly runs = new RunRepository();
  private readonly jobs = new JobRepository();
  private readonly workflowStates = new WorkflowStateRepository();

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
  ) {}

  isRunning(): boolean {
    return this.activeRunsByProject.size > 0;
  }

  getStatus(): { running: boolean; activeRun: ActiveRunSnapshot | null } {
    const first = this.activeRunsByProject.values().next().value ?? null;
    return {
      running: this.activeRunsByProject.size > 0,
      activeRun: first ? { ...first } : null,
    };
  }

  async checkWorkerHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.workerUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body.ok === true;
    } catch {
      return false;
    }
  }

  buildRunVncUrl(projectId: string, runId: string): string {
    return `/api/projects/${projectId}/runs/${runId}/vnc`;
  }

  getRunVncFields(
    projectId: string,
    run: RunRecord,
    userId?: string | null,
  ): { vncUrl: string | null; vncToken?: string } {
    if (!this.isRunVncActive(run)) {
      return { vncUrl: null };
    }
    const vncUrl = this.buildRunVncUrl(projectId, run.id);
    if (authDisabled() || !userId) {
      return { vncUrl };
    }
    return { vncUrl, vncToken: createVncToken(run.id, userId, "run") };
  }

  isRunVncActive(run: RunRecord): boolean {
    return run.status === "running" && effectiveVncPreviewFromRunOptions(run.options);
  }

  async getRunVncMeta(projectId: string, runId: string): Promise<{ active: true } | null> {
    const run = await this.runs.findById(runId);
    if (!run || run.projectId !== projectId || !this.isRunVncActive(run)) {
      return null;
    }
    return { active: true };
  }

  async startRun(
    projectId: string,
    options: RunStartOptions = {},
    ctx: { userId?: string | null } = {},
  ): Promise<RunRecord> {
    if (this.activeRunsByProject.has(projectId)) {
      throw new AppError("RUN_IN_PROGRESS", "A run is already in progress for this project", 409);
    }

    const workerOk = await this.checkWorkerHealth();
    if (!workerOk) {
      throw new AppError("WORKER_UNAVAILABLE", "Worker is unavailable", 503);
    }

    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }

    const resolved = resolveRunOptions(options);
    let nodeIds = resolved.nodeIds;
    let parentRunId = resolved.parentRunId;

    if (options.rerunFailedOnly) {
      const prevId = options.previousRunId;
      if (!prevId) {
        throw new AppError("PREVIOUS_RUN_REQUIRED", "previousRunId is required for rerunFailedOnly", 422);
      }
      const prev = await this.runs.findById(prevId);
      if (!prev || prev.projectId !== projectId) {
        throw new AppError("RUN_NOT_FOUND", `Previous run not found: ${prevId}`, 404);
      }
      nodeIds = prev.failedNodeIds;
      parentRunId = prevId;
      if (nodeIds.length === 0) {
        throw new AppError("NO_FAILED_TESTS", "Previous run has no failed node ids", 422);
      }
    }

    const runOptions: PytestRunOptions = {
      workspacePath: project.workspacePath,
      headed: resolved.headed,
      slowmo: resolved.slowmo,
      specFilter: resolved.specFilter,
      nodeIds,
    };

    const now = new Date().toISOString();
    const runId = randomUUID();
    const jobId = randomUUID();

    const run: RunRecord = {
      id: runId,
      projectId,
      jobId,
      status: "running",
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: null,
      reportPath: "tests/report.html",
      logPath: `tests/.runs/${runId}/run.log`,
      options: {
        workspacePath: runOptions.workspacePath,
        headed: resolved.headed,
        slowmo: runOptions.slowmo,
        vncPreview: resolved.vncPreview,
        specFilter: runOptions.specFilter ?? null,
        nodeIds,
        rerunFailedOnly: options.rerunFailedOnly ?? false,
      },
      preset: resolved.preset,
      failedNodeIds: [],
      parentRunId,
      triggerSource: options.triggerSource ?? "web",
      startedAt: now,
      finishedAt: null,
      createdAt: now,
    };

    await this.jobs.insert({
      id: jobId,
      projectId,
      type: "run",
      status: "running",
      error: null,
      result: { runId },
      startedAt: now,
      finishedAt: null,
    });
    await this.runs.insert(run);

    await this.workflowStates.update(projectId, {
      stage: "run",
      stageStatus: "running",
    });

    this.cancelled = false;
    this.activeRunsByProject.set(projectId, { runId, projectId, jobId, startedAt: now });
    this.abortController = new AbortController();

    const vncFields = this.getRunVncFields(projectId, run, ctx.userId);
    wsHub.broadcast({
      type: "run_started",
      runId,
      projectId,
      jobId,
      vncUrl: vncFields.vncUrl ?? undefined,
      vncToken: vncFields.vncToken,
    });

    void this.executeRun(
      run,
      project.workspacePath,
      runOptions,
      effectiveVncPreview(resolved),
    ).catch((err) => {
      console.error(`[run-service] ${runId} failed:`, err);
    });

    return run;
  }

  async cancelRun(runId: string): Promise<boolean> {
    const active = [...this.activeRunsByProject.values()].find((r) => r.runId === runId);
    if (!active) {
      return false;
    }
    this.cancelled = true;
    this.abortController?.abort();

    try {
      await fetch(`${this.config.workerUrl}/internal/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // ignore worker cancel errors
    }

    return true;
  }

  async getRun(projectId: string, runId: string): Promise<RunRecord | null> {
    const run = await this.runs.findById(runId);
    if (!run || run.projectId !== projectId) return null;
    return run;
  }

  async listRuns(projectId: string): Promise<RunRecord[]> {
    return this.runs.listByProject(projectId);
  }

  async getReportPath(projectId: string, runId: string): Promise<string> {
    const run = await this.getRun(projectId, runId);
    if (!run) {
      throw new AppError("RUN_NOT_FOUND", `Run not found: ${runId}`, 404);
    }
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }
    const rel = run.reportPath ?? "tests/report.html";
    const abs = path.join(project.workspacePath, rel);
    await fs.access(abs).catch(() => {
      throw new AppError("REPORT_NOT_FOUND", `Report not found for run ${runId}`, 404);
    });
    return abs;
  }

  async getTracePath(
    projectId: string,
    runId: string,
    traceName: string,
  ): Promise<string> {
    const run = await this.getRun(projectId, runId);
    if (!run) {
      throw new AppError("RUN_NOT_FOUND", `Run not found: ${runId}`, 404);
    }
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }

    const normalized = traceName.replace(/^\/+/, "").replace(/^tests\//, "");
    const abs = path.resolve(project.workspacePath, "tests", normalized);
    const allowedRoot = path.resolve(project.workspacePath, "tests/test-results");
    if (!abs.startsWith(`${allowedRoot}${path.sep}`) && abs !== allowedRoot) {
      throw new AppError("TRACE_NOT_FOUND", `Trace not found: ${traceName}`, 404);
    }
    await fs.access(abs).catch(() => {
      throw new AppError("TRACE_NOT_FOUND", `Trace not found: ${traceName}`, 404);
    });
    return abs;
  }

  private async executeRun(
    run: RunRecord,
    workspacePath: string,
    options: PytestRunOptions,
    vncPreview: boolean,
  ): Promise<void> {
    const command = buildPytestCommand(options);
    const logLines: string[] = [];
    let finishedPayload: Record<string, unknown> | null = null;

    try {
      const response = await fetch(`${this.config.workerUrl}/internal/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: run.id,
          workspacePath,
          command,
          vncPreview,
        }),
        signal: this.abortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`Worker returned HTTP ${response.status}`);
      }

      for await (const event of readNdjsonStream(response.body)) {
        if (event.type === "log" && typeof event.line === "string") {
          logLines.push(event.line);
          wsHub.broadcast({ type: "run_log", runId: run.id, line: event.line });
        }
        if (event.type === "finished") {
          finishedPayload = event;
          break;
        }
      }
    } catch (err) {
      if (this.cancelled) {
        await this.finalizeRun(run, {
          status: "cancelled",
          passed: 0,
          failed: 0,
          skipped: 0,
          durationMs: null,
          error: "Cancelled by user",
          logLines,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.finalizeRun(run, {
        status: "failed",
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: null,
        error: message,
        logLines,
      });
      return;
    }

    let exitCode = Number(finishedPayload?.exitCode ?? 1);
    let passed = Number(finishedPayload?.passed ?? 0);
    let failed = Number(finishedPayload?.failed ?? 0);
    let skipped = Number(finishedPayload?.skipped ?? 0);
    let durationMs = Number(finishedPayload?.durationMs ?? 0);

    if (!finishedPayload || (passed === 0 && failed === 0 && skipped === 0)) {
      const parsed = parsePytestSummaryFromLogs(logLines);
      if (parsed.passed || parsed.failed || parsed.skipped) {
        passed = parsed.passed;
        failed = parsed.failed;
        skipped = parsed.skipped;
        durationMs = parsed.durationMs || durationMs;
        exitCode = failed > 0 ? 1 : 0;
      }
    }

    const status = this.cancelled
      ? "cancelled"
      : exitCode === 0 && failed === 0
        ? "passed"
        : "failed";

    await this.finalizeRun(run, {
      status,
      passed,
      failed,
      skipped,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      error: status === "failed" ? `pytest exit code ${exitCode}` : null,
      logLines,
    });
  }

  private async finalizeRun(
    run: RunRecord,
    result: {
      status: RunRecord["status"];
      passed: number;
      failed: number;
      skipped: number;
      durationMs: number | null;
      error: string | null;
      logLines: string[];
    },
  ): Promise<void> {
    let status = result.status;
    let passed = result.passed;
    let failed = result.failed;
    let skipped = result.skipped;
    let durationMs = result.durationMs;

    if (passed === 0 && failed === 0 && skipped === 0 && result.logLines.length > 0) {
      const parsed = parsePytestSummaryFromLogs(result.logLines);
      if (parsed.passed || parsed.failed || parsed.skipped) {
        passed = parsed.passed;
        failed = parsed.failed;
        skipped = parsed.skipped;
        durationMs = parsed.durationMs || durationMs;
        if (status !== "cancelled") {
          status = failed > 0 ? "failed" : "passed";
        }
      }
    }

    const failedNodeIds =
      status === "failed" || failed > 0
        ? parseFailedNodeIdsFromLogs(result.logLines)
        : run.failedNodeIds;

    const finishedAt = new Date().toISOString();
    const updatedRun: RunRecord = {
      ...run,
      status,
      passed,
      failed,
      skipped,
      durationMs,
      failedNodeIds,
      finishedAt,
    };

    await this.runs.update(updatedRun);

    const job = await this.jobs.findById(run.jobId!);
    if (job) {
      await this.jobs.update({
        ...job,
        status: status === "cancelled" ? "cancelled" : status === "passed" ? "completed" : "failed",
        error: result.error,
        finishedAt,
        result: {
          ...(job.result ?? {}),
          runId: run.id,
          passed,
          failed,
          skipped,
          durationMs,
        },
      });
    }

    await this.workflowStates.update(run.projectId, {
      stage: "run",
      stageStatus: status === "passed" ? "idle" : "failed",
    });

    const project = await this.projectService.getById(run.projectId);
    if (project) {
      await this.writeRunMeta(project.workspacePath, run.id, updatedRun, result.logLines);
    }

    wsHub.broadcast({
      type: "run_finished",
      runId: run.id,
      passed,
      failed,
      skipped,
      durationMs: durationMs ?? 0,
    });

    this.activeRunsByProject.delete(run.projectId);
    this.cancelled = false;
    this.abortController = null;
  }

  private async writeRunMeta(
    workspacePath: string,
    runId: string,
    run: RunRecord,
    logLines: string[],
  ): Promise<void> {
    const dir = path.join(workspacePath, "tests/.runs", runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "run.log"), logLines.join("\n"));
    await fs.writeFile(
      path.join(dir, "run-meta.json"),
      JSON.stringify(
        {
          runId,
          projectId: run.projectId,
          status: run.status,
          passed: run.passed,
          failed: run.failed,
          skipped: run.skipped,
          durationMs: run.durationMs,
          reportPath: run.reportPath,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          options: run.options,
        },
        null,
        2,
      ),
    );
  }
}
