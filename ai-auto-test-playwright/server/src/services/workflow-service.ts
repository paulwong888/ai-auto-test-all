import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors.js";
import { WorkflowStateRepository } from "../repositories/workflow-state-repository.js";
import { normalizeModuleName } from "../utils/module-name.js";
import type { ProjectTemplateService } from "./project-template-service.js";
import type { ProjectService } from "./project-service.js";

const MAX_UPLOAD_BYTES = 1024 * 1024;

export class WorkflowService {
  private readonly workflowStates = new WorkflowStateRepository();

  constructor(
    private readonly projectService: ProjectService,
    private readonly templateService: ProjectTemplateService,
  ) {}

  async initTemplate(projectId: string) {
    const project = await this.requireProject(projectId);
    const result = await this.templateService.initTemplate(project.workspacePath, project.baseUrl);
    await this.workflowStates.update(projectId, {
      stage: "init",
      stageStatus: "idle",
    });
    return result;
  }

  async uploadRecording(
    projectId: string,
    moduleNameRaw: string,
    file: { buffer: Buffer; size: number; originalname: string },
  ) {
    const moduleName = normalizeModuleName(moduleNameRaw);
    const project = await this.requireProject(projectId);

    if (!file || !file.buffer?.length) {
      throw new AppError("EMPTY_FILE", "Uploaded file is empty", 422);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError("FILE_TOO_LARGE", "Uploaded file exceeds 1MB limit", 422);
    }
    if (!file.originalname.endsWith(".py")) {
      throw new AppError("INVALID_FILE_TYPE", "Only .py files are allowed", 422);
    }

    const text = file.buffer.toString("utf8");
    if (!/\b(from\s+playwright|import\s+playwright)\b/i.test(text)) {
      throw new AppError(
        "INVALID_RECORDED",
        "File must contain a playwright import (from playwright or import playwright)",
        422,
      );
    }

    const relPath = path.join("tests", "recorded", `${moduleName}.py`);
    const absPath = path.join(project.workspacePath, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.buffer);

    await this.workflowStates.update(projectId, {
      stage: "recorded",
      stageStatus: "idle",
      moduleName,
      artifactPaths: { recorded: relPath.split(path.sep).join("/") },
    });

    return {
      moduleName,
      path: relPath.split(path.sep).join("/"),
      sizeBytes: file.size,
      workflowStage: "recorded" as const,
    };
  }

  async getWorkflow(projectId: string) {
    const project = await this.requireProject(projectId);
    const workflow = await this.workflowStates.findByProjectId(projectId);
    return {
      projectId,
      workspacePath: project.workspacePath,
      stage: workflow?.stage ?? "init",
      stageStatus: workflow?.stageStatus ?? "idle",
      moduleName: workflow?.moduleName ?? null,
      artifactPaths: workflow?.artifactPaths ?? {},
      updatedAt: workflow?.updatedAt ?? null,
    };
  }

  private async requireProject(projectId: string) {
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }
    return project;
  }
}
