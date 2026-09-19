import fs from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { JobRecord } from "../repositories/job-repository.js";
import {
  PlanVersionRepository,
  type PlanVersionRecord,
} from "../repositories/plan-version-repository.js";
import { WorkflowStateRepository } from "../repositories/workflow-state-repository.js";
import { buildPlanPrompt } from "./plan-prompt.js";
import { PiJobRunner, type PiJobContext } from "./pi-job-runner.js";
import type { ProjectService } from "./project-service.js";

const TC_RE = /TC-\d+/i;

export class PlanService {
  private readonly workflowStates = new WorkflowStateRepository();
  private readonly planVersions = new PlanVersionRepository();
  private readonly piJobs: PiJobRunner;

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
    piJobs?: PiJobRunner,
  ) {
    this.piJobs = piJobs ?? new PiJobRunner(config);
  }

  async resolveModuleName(projectId: string, moduleName?: string): Promise<string> {
    if (moduleName?.trim()) {
      const { normalizeModuleName } = await import("../utils/module-name.js");
      return normalizeModuleName(moduleName);
    }
    const workflow = await this.workflowStates.findByProjectId(projectId);
    if (!workflow?.moduleName) {
      throw new AppError("MODULE_REQUIRED", "moduleName is required", 422);
    }
    return workflow.moduleName;
  }

  async startPlanGeneration(projectId: string, moduleName: string): Promise<JobRecord> {
    const project = await this.requireProject(projectId);
    const ctx = this.buildContext(project.workspacePath, projectId, moduleName);
    const recordedPath = path.join(ctx.workspacePath, "tests/recorded", `${moduleName}.py`);

    await fs.access(recordedPath).catch(() => {
      throw new AppError(
        "RECORDED_NOT_FOUND",
        `Recorded file not found: tests/recorded/${moduleName}.py`,
        422,
      );
    });

    await this.workflowStates.update(projectId, {
      stageStatus: "generating",
      moduleName,
    });

    try {
      return await this.piJobs.startJob(ctx, project.baseUrl, {
        type: "plan",
        generatingWs: (c, jobId) => ({ type: "plan_generating", projectId: c.projectId, jobId }),
        readyWs: (c, jobId, extra) => ({
          type: "plan_ready",
          projectId: c.projectId,
          jobId,
          planPath: extra?.planPath ?? `tests/plans/${c.moduleName}-test-plan.md`,
        }),
        failedWs: (c, jobId, error) => ({
          type: "plan_failed",
          projectId: c.projectId,
          jobId,
          error,
        }),
        buildPrompt: (c, baseUrl) => buildPlanPrompt(c.moduleName, baseUrl),
        onFailed: async (c) => {
          await this.workflowStates.update(c.projectId, { stageStatus: "failed" });
        },
        validateOutput: async (c) => {
          const planPath = `tests/plans/${c.moduleName}-test-plan.md`;
          const abs = path.join(c.workspacePath, planPath);
          const stat = await fs.stat(abs).catch(() => null);
          if (!stat || stat.size === 0) {
            throw new Error(`Plan file was not created: ${planPath}`);
          }

          const content = await fs.readFile(abs, "utf8");
          const version = await this.planVersions.saveVersion({
            projectId: c.projectId,
            moduleName: c.moduleName,
            content,
            source: "ai",
          });

          await this.workflowStates.update(c.projectId, {
            stage: "plan",
            stageStatus: "idle",
            moduleName: c.moduleName,
            artifactPaths: {
              recorded: `tests/recorded/${c.moduleName}.py`,
              plan: planPath,
              planVersionId: version.id,
            },
          });

          return { moduleName: c.moduleName, planPath, planVersionId: version.id };
        },
      });
    } catch (err) {
      await this.workflowStates.update(projectId, { stageStatus: "failed" }).catch(() => undefined);
      throw err;
    }
  }

  async getPlan(projectId: string, moduleName?: string): Promise<{
    moduleName: string;
    path: string;
    content: string;
    workflowStage: string;
    generatedAt: string | null;
    planVersionId: string | null;
    versionNumber: number | null;
    source: string | null;
  }> {
    const project = await this.requireProject(projectId);
    const workflow = await this.workflowStates.findByProjectId(projectId);
    const resolvedModule = moduleName ?? workflow?.moduleName;
    if (!resolvedModule) {
      throw new AppError("MODULE_REQUIRED", "moduleName is required", 422);
    }

    const relPath = `tests/plans/${resolvedModule}-test-plan.md`;
    const latest = await this.planVersions.getLatest(projectId, resolvedModule);

    if (latest) {
      return {
        moduleName: resolvedModule,
        path: relPath,
        content: latest.content,
        workflowStage: workflow?.stage ?? "init",
        generatedAt: latest.createdAt,
        planVersionId: latest.id,
        versionNumber: latest.versionNumber,
        source: latest.source,
      };
    }

    const abs = path.join(project.workspacePath, relPath);
    const content = await fs.readFile(abs, "utf8").catch(() => {
      throw new AppError("PLAN_NOT_FOUND", `Plan not found: ${relPath}`, 404);
    });

    const stat = await fs.stat(abs);
    return {
      moduleName: resolvedModule,
      path: relPath,
      content,
      workflowStage: workflow?.stage ?? "init",
      generatedAt: stat.mtime.toISOString(),
      planVersionId: null,
      versionNumber: null,
      source: null,
    };
  }

  async savePlan(
    projectId: string,
    input: {
      content: string;
      baseVersionId?: string;
      message?: string;
      moduleName?: string;
    },
  ): Promise<PlanVersionRecord> {
    if (!TC_RE.test(input.content)) {
      throw new AppError(
        "PLAN_TC_REQUIRED",
        "Plan must contain at least one TC identifier (e.g. TC-001)",
        422,
      );
    }

    const project = await this.requireProject(projectId);
    const moduleName = await this.resolveModuleName(projectId, input.moduleName);
    const relPath = `tests/plans/${moduleName}-test-plan.md`;
    const abs = path.join(project.workspacePath, relPath);

    const version = await this.planVersions.saveVersion({
      projectId,
      moduleName,
      content: input.content,
      source: "user",
      baseVersionId: input.baseVersionId ?? null,
      message: input.message ?? null,
    });

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.content);

    await this.workflowStates.update(projectId, {
      stage: "plan",
      stageStatus: "idle",
      moduleName,
      artifactPaths: {
        recorded: `tests/recorded/${moduleName}.py`,
        plan: relPath,
        planVersionId: version.id,
      },
    });

    return version;
  }

  async listPlanVersions(projectId: string, moduleName?: string): Promise<PlanVersionRecord[]> {
    const resolved = await this.resolveModuleName(projectId, moduleName);
    return this.planVersions.listByProjectModule(projectId, resolved);
  }

  async getPlanVersion(projectId: string, versionId: string): Promise<PlanVersionRecord> {
    const version = await this.planVersions.findById(versionId);
    if (!version || version.projectId !== projectId) {
      throw new AppError("PLAN_VERSION_NOT_FOUND", `Plan version not found: ${versionId}`, 404);
    }
    return version;
  }

  async diffPlanVersions(projectId: string, v1Id: string, v2Id: string): Promise<string> {
    const [a, b] = await Promise.all([
      this.getPlanVersion(projectId, v1Id),
      this.getPlanVersion(projectId, v2Id),
    ]);
    return createTwoFilesPatch(
      `v${a.versionNumber}`,
      `v${b.versionNumber}`,
      a.content,
      b.content,
      "",
      "",
    );
  }

  async syncPlanFileFromVersion(
    projectId: string,
    versionId: string,
  ): Promise<{ moduleName: string; planPath: string; content: string }> {
    const project = await this.requireProject(projectId);
    const version = await this.getPlanVersion(projectId, versionId);
    const relPath = `tests/plans/${version.moduleName}-test-plan.md`;
    const abs = path.join(project.workspacePath, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, version.content);
    return { moduleName: version.moduleName, planPath: relPath, content: version.content };
  }

  getJob(jobId: string): Promise<JobRecord | null> {
    return this.piJobs.getJob(jobId);
  }

  cancelJob(jobId: string): Promise<JobRecord | null> {
    return this.piJobs.cancelJob(jobId);
  }

  private buildContext(workspacePath: string, projectId: string, moduleName: string): PiJobContext {
    return { projectId, workspacePath, moduleName };
  }

  private async requireProject(projectId: string) {
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }
    return project;
  }
}
