import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { JobRecord } from "../repositories/job-repository.js";
import {
  FixSuggestionRepository,
  type FailingTest,
} from "../repositories/fix-suggestion-repository.js";
import { FixIterationRepository } from "../repositories/fix-iteration-repository.js";
import { RunRepository } from "../repositories/run-repository.js";
import { WorkflowStateRepository } from "../repositories/workflow-state-repository.js";
import { buildFixPrompt } from "./fix-prompt.js";
import { FixApplyService } from "./fix-apply-service.js";
import {
  parseFixAnalysisJson,
  parsePatchesArray,
  selectPatches,
} from "./fix-patch-parser.js";
import { PiJobRunner, type PiJobContext } from "./pi-job-runner.js";
import type { ProjectService } from "./project-service.js";
import type { RunService } from "./run-service.js";

const FIX_MAX_ITERATIONS = Number(process.env.FIX_MAX_ITERATIONS ?? 3);

export class FixService {
  private readonly runs = new RunRepository();
  private readonly fixSuggestions = new FixSuggestionRepository();
  private readonly fixIterations = new FixIterationRepository();
  private readonly fixApply = new FixApplyService();
  private readonly workflowStates = new WorkflowStateRepository();
  private readonly piJobs: PiJobRunner;
  private runService: RunService | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
    piJobs?: PiJobRunner,
  ) {
    this.piJobs = piJobs ?? new PiJobRunner(config);
  }

  setRunService(runService: RunService): void {
    this.runService = runService;
  }

  async startFixAnalysis(projectId: string, runId: string): Promise<JobRecord> {
    const project = await this.requireProject(projectId);
    const run = await this.runs.findById(runId);
    if (!run || run.projectId !== projectId) {
      throw new AppError("RUN_NOT_FOUND", `Run not found: ${runId}`, 404);
    }
    if (run.status !== "failed" && run.failed <= 0) {
      throw new AppError(
        "RUN_NOT_FAILED",
        "Fix analysis requires a failed run (status=failed or failed>0)",
        422,
      );
    }

    const workflow = await this.workflowStates.findByProjectId(projectId);
    const moduleName = workflow?.moduleName ?? "saucedemo";
    const ctx: PiJobContext = {
      projectId,
      workspacePath: project.workspacePath,
      moduleName,
    };

    const logPath = path.join(project.workspacePath, "tests/.runs", runId, "run.log");
    await fs.access(logPath).catch(() => {
      throw new AppError("RUN_LOG_NOT_FOUND", `Run log not found: tests/.runs/${runId}/run.log`, 422);
    });

    const iteration = (await this.fixIterations.getLatestIteration(runId)) + 1;

    return this.piJobs.startJob(ctx, project.baseUrl, {
      type: "fix",
      generatingWs: (c, jobId) => ({
        type: "fix_generating",
        projectId: c.projectId,
        jobId,
        runId,
      }),
      readyWs: (c, jobId) => ({
        type: "fix_ready",
        projectId: c.projectId,
        jobId,
        runId,
      }),
      failedWs: (c, jobId, error) => ({
        type: "fix_failed",
        projectId: c.projectId,
        jobId,
        runId,
        error,
      }),
      buildPrompt: () => buildFixPrompt(runId),
      validateOutput: async (c) => {
        const tracePaths = await this.scanTracePaths(c.workspacePath);
        const parsed = await this.readFixAnalysis(c.workspacePath, runId);
        const failingTests = parsed.failingTests.length
          ? parsed.failingTests
          : await this.parseFailingFromLog(c.workspacePath, runId);

        const suggestionId = randomUUID();
        await this.fixSuggestions.insert({
          id: suggestionId,
          runId,
          analysisMd: parsed.analysis,
          failingTests,
          patches: parsed.patches,
          iteration,
        });

        return { runId, failingTests, analysis: parsed.analysis, tracePaths, suggestionId, patches: parsed.patches };
      },
    });
  }

  async applyFix(
    projectId: string,
    input: {
      suggestionId: string;
      patchIndexes: number[];
      autoVerify?: boolean;
    },
  ): Promise<{
    appliedFiles: string[];
    verifyRunId: string | null;
    iteration: number;
  }> {
    const suggestion = await this.fixSuggestions.findById(input.suggestionId);
    if (!suggestion) {
      throw new AppError("FIX_NOT_FOUND", "Fix suggestion not found", 404);
    }

    const run = await this.runs.findById(suggestion.runId);
    if (!run || run.projectId !== projectId) {
      throw new AppError("RUN_NOT_FOUND", "Associated run not found", 404);
    }

    const currentIteration = await this.fixIterations.getLatestIteration(suggestion.runId);
    if (currentIteration >= FIX_MAX_ITERATIONS) {
      throw new AppError(
        "FIX_ITERATION_LIMIT",
        `Maximum fix iterations (${FIX_MAX_ITERATIONS}) reached`,
        422,
      );
    }

    const patches = selectPatches(suggestion.patches, input.patchIndexes);
    const project = await this.requireProject(projectId);
    const { appliedFiles } = await this.fixApply.applyPatches(project.workspacePath, patches);

    const iteration = currentIteration + 1;
    const iterationId = randomUUID();
    await this.fixIterations.insert({
      id: iterationId,
      runId: suggestion.runId,
      iteration,
      suggestionId: suggestion.id,
      patchesApplied: patches,
    });

    let verifyRunId: string | null = null;
    if (input.autoVerify) {
      verifyRunId = await this.startVerifyRun(projectId, suggestion.runId, iterationId);
    }

    return { appliedFiles, verifyRunId, iteration };
  }

  async verifyFix(
    projectId: string,
    runId: string,
  ): Promise<{ verifyRunId: string }> {
    const run = await this.runs.findById(runId);
    if (!run || run.projectId !== projectId) {
      throw new AppError("RUN_NOT_FOUND", `Run not found: ${runId}`, 404);
    }
    const latest = await this.fixIterations.getLatestIteration(runId);
    const iterations = await this.fixIterations.listByRunId(runId);
    const last = iterations[iterations.length - 1];
    const verifyRunId = await this.startVerifyRun(
      projectId,
      runId,
      last?.id ?? randomUUID(),
    );
    return { verifyRunId };
  }

  async getFixHistory(projectId: string, runId: string) {
    const run = await this.runs.findById(runId);
    if (!run || run.projectId !== projectId) {
      throw new AppError("RUN_NOT_FOUND", `Run not found: ${runId}`, 404);
    }
    const iterations = await this.fixIterations.listByRunId(runId);
    const suggestion = await this.fixSuggestions.findByRunId(runId);
    return { runId, iterations, suggestion };
  }

  async getFixSuggestion(
    projectId: string,
    runId: string,
  ): Promise<{
    runId: string;
    suggestionId: string | null;
    failingTests: FailingTest[];
    analysis: string;
    patches: Array<{ file: string; unifiedDiff: string; description?: string }>;
    tracePaths: string[];
    iteration: number | null;
  } | null> {
    const run = await this.runs.findById(runId);
    if (!run || run.projectId !== projectId) {
      throw new AppError("RUN_NOT_FOUND", `Run not found: ${runId}`, 404);
    }

    const record = await this.fixSuggestions.findByRunId(runId);
    if (!record) return null;

    const project = await this.requireProject(projectId);
    const tracePaths = await this.scanTracePaths(project.workspacePath);

    return {
      runId,
      suggestionId: record.id,
      failingTests: record.failingTests,
      analysis: record.analysisMd,
      patches: record.patches,
      tracePaths,
      iteration: record.iteration,
    };
  }

  private async startVerifyRun(
    projectId: string,
    originalRunId: string,
    iterationId: string,
  ): Promise<string> {
    if (!this.runService) {
      throw new AppError("RUN_SERVICE_UNAVAILABLE", "Run service not configured", 500);
    }
    const original = await this.runs.findById(originalRunId);
    if (!original) {
      throw new AppError("RUN_NOT_FOUND", `Run not found: ${originalRunId}`, 404);
    }
    const nodeIds = original.failedNodeIds;
    if (nodeIds.length === 0) {
      throw new AppError("NO_FAILED_TESTS", "No failed node ids to verify", 422);
    }

    const verifyRun = await this.runService.startRun(projectId, {
      preset: "ci",
      nodeIds,
      previousRunId: originalRunId,
    });

    void this.pollVerifyResult(iterationId, verifyRun.id);
    return verifyRun.id;
  }

  private async pollVerifyResult(iterationId: string, verifyRunId: string): Promise<void> {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const run = await this.runs.findById(verifyRunId);
      if (!run || run.status === "running" || run.status === "pending") continue;
      const result =
        run.status === "passed" ? "passed" : run.failed > 0 ? "failed" : "skipped";
      await this.fixIterations.updateResult(iterationId, verifyRunId, result);
      return;
    }
  }

  private async readFixAnalysis(
    workspacePath: string,
    runId: string,
  ): Promise<{ failingTests: FailingTest[]; analysis: string; patches: ReturnType<typeof parsePatchesArray> }> {
    const analysisPath = path.join(workspacePath, "tests/.runs", runId, "fix-analysis.json");
    try {
      const raw = await fs.readFile(analysisPath, "utf8");
      const parsed = parseFixAnalysisJson(raw);
      return parsed;
    } catch (err) {
      if (err instanceof AppError) throw err;
      const logPath = path.join(workspacePath, "tests/.runs", runId, "run.log");
      const log = await fs.readFile(logPath, "utf8").catch(() => "");
      return {
        failingTests: await this.parseFailingFromLog(workspacePath, runId),
        analysis: log
          ? `## 分析\n\nPi 未生成结构化 fix-analysis.json，以下为 run.log 摘要：\n\n\`\`\`\n${log.slice(-4000)}\n\`\`\``
          : "## 分析\n\n未能读取失败日志。",
        patches: [],
      };
    }
  }

  private async parseFailingFromLog(
    workspacePath: string,
    runId: string,
  ): Promise<FailingTest[]> {
    const logPath = path.join(workspacePath, "tests/.runs", runId, "run.log");
    const log = await fs.readFile(logPath, "utf8").catch(() => "");
    const tests: FailingTest[] = [];
    const failRe = /FAILED\s+(specs\/[^\s]+::[^\s]+)/g;
    let match: RegExpExecArray | null;
    while ((match = failRe.exec(log)) !== null) {
      const nodeId = match[1]!;
      tests.push({
        tc: nodeId.split("::").pop() ?? nodeId,
        nodeId,
        error: "See run.log for details",
      });
    }
    return tests;
  }

  private async scanTracePaths(workspacePath: string): Promise<string[]> {
    const root = path.join(workspacePath, "tests/test-results");
    const traces: string[] = [];
    await this.walkTraces(root, path.join(workspacePath, "tests"), traces);
    return traces.sort();
  }

  private async walkTraces(dir: string, testsRoot: string, traces: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkTraces(abs, testsRoot, traces);
      } else if (entry.name === "trace.zip") {
        traces.push(path.relative(testsRoot, abs).split(path.sep).join("/"));
      }
    }
  }

  private async requireProject(projectId: string) {
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }
    return project;
  }
}
