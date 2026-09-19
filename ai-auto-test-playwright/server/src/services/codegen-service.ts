import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import type { JobRecord } from "../repositories/job-repository.js";
import { PlanVersionRepository } from "../repositories/plan-version-repository.js";
import { WorkflowStateRepository } from "../repositories/workflow-state-repository.js";
import { buildCodePrompt } from "./code-prompt.js";
import { readFileContentIfText } from "../utils/text-file-content.js";
import { PiJobRunner, type PiJobContext } from "./pi-job-runner.js";
import type { ProjectService } from "./project-service.js";

export class CodegenService {
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

  async startCodeGeneration(
    projectId: string,
    moduleName: string,
    confirmPlan: boolean,
    planVersionId?: string,
  ): Promise<JobRecord> {
    if (!confirmPlan) {
      throw new AppError("PLAN_NOT_CONFIRMED", "confirmPlan must be true", 422);
    }

    const project = await this.requireProject(projectId);
    let resolvedModule = moduleName;

    if (planVersionId) {
      const version = await this.planVersions.findById(planVersionId);
      if (!version || version.projectId !== projectId) {
        throw new AppError("PLAN_VERSION_NOT_FOUND", `Plan version not found: ${planVersionId}`, 404);
      }
      resolvedModule = version.moduleName;
      const relPath = `tests/plans/${resolvedModule}-test-plan.md`;
      const abs = path.join(project.workspacePath, relPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, version.content);
    }

    const ctx = this.buildContext(project.workspacePath, projectId, resolvedModule);
    const planPath = path.join(ctx.workspacePath, "tests/plans", `${resolvedModule}-test-plan.md`);

    await fs.access(planPath).catch(() => {
      throw new AppError(
        "PLAN_NOT_FOUND",
        `Plan file not found: tests/plans/${resolvedModule}-test-plan.md`,
        422,
      );
    });

    await this.workflowStates.update(projectId, {
      stageStatus: "generating",
      moduleName: resolvedModule,
    });

    try {
      return await this.piJobs.startJob(ctx, project.baseUrl, {
        type: "code",
        generatingWs: (c, jobId) => ({ type: "code_generating", projectId: c.projectId, jobId }),
        readyWs: (c, jobId) => ({ type: "code_ready", projectId: c.projectId, jobId }),
        failedWs: (c, jobId, error) => ({
          type: "code_failed",
          projectId: c.projectId,
          jobId,
          error,
        }),
        buildPrompt: (c, baseUrl) => buildCodePrompt(c.moduleName, baseUrl),
        onFailed: async (c) => {
          await this.workflowStates.update(c.projectId, { stageStatus: "failed" });
        },
        validateOutput: async (c) => {
          const specsDir = path.join(c.workspacePath, "tests/specs");
          const entries = await fs.readdir(specsDir).catch(() => [] as string[]);
          const specFiles = entries.filter((name) => name.endsWith(".py") && !name.startsWith("."));
          if (specFiles.length === 0) {
            throw new Error("No spec files generated under tests/specs/");
          }

          await this.workflowStates.update(c.projectId, {
            stage: "code",
            stageStatus: "idle",
            moduleName: c.moduleName,
            artifactPaths: {
              recorded: `tests/recorded/${c.moduleName}.py`,
              plan: `tests/plans/${c.moduleName}-test-plan.md`,
              specs: specFiles.map((f) => `tests/specs/${f}`),
            },
          });

          return { moduleName: c.moduleName, specFiles };
        },
      });
    } catch (err) {
      await this.workflowStates.update(projectId, { stageStatus: "failed" }).catch(() => undefined);
      throw err;
    }
  }

  async listFiles(
    projectId: string,
  ): Promise<{ workflowStage: string; files: Array<{ path: string; content?: string }> }> {
    const project = await this.requireProject(projectId);
    const workflow = await this.workflowStates.findByProjectId(projectId);
    const testsRoot = path.join(project.workspacePath, "tests");
    const paths: string[] = [];

    await this.walk(testsRoot, testsRoot, paths);

    const files = await Promise.all(
      paths.sort().map(async (rel) => {
        const abs = path.join(testsRoot, rel);
        return readFileContentIfText(abs, rel);
      }),
    );

    return {
      workflowStage: workflow?.stage ?? "init",
      files,
    };
  }

  getJob(jobId: string): Promise<JobRecord | null> {
    return this.piJobs.getJob(jobId);
  }

  cancelJob(jobId: string): Promise<JobRecord | null> {
    return this.piJobs.cancelJob(jobId);
  }

  private async walk(root: string, dir: string, files: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === ".venv" || entry.name === "__pycache__" || entry.name === ".pytest_cache") {
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(root, abs, files);
      } else if (entry.isFile()) {
        files.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
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
