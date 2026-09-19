import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { WorkflowStateRepository } from "../repositories/workflow-state-repository.js";
import {
  createProjectInputSchema,
  projectSchema,
  updateProjectInputSchema,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from "../schemas/project.js";
export class ProjectService {
  private readonly projects: ProjectRepository;
  private readonly workflowStates: WorkflowStateRepository;

  constructor(
    private readonly config: AppConfig,
    projects?: ProjectRepository,
    workflowStates?: WorkflowStateRepository,
  ) {
    this.projects = projects ?? new ProjectRepository();
    this.workflowStates = workflowStates ?? new WorkflowStateRepository();
  }

  getAllowedPrefixes(): string[] {
    return [...this.config.allowedRepoPrefixes];
  }

  normalizeWorkspacePath(workspacePath: string): string {
    return path.resolve(workspacePath);
  }

  assertAllowedWorkspacePath(workspacePath: string): string {
    const normalized = this.normalizeWorkspacePath(workspacePath);
    const allowed = this.config.allowedRepoPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`),
    );
    if (!allowed) {
      throw new AppError(
        "INVALID_WORKSPACE",
        `workspacePath must be under allowed prefixes: ${this.config.allowedRepoPrefixes.join(", ")}`,
        422,
      );
    }
    return normalized;
  }

  async list(): Promise<Project[]> {
    const records = await this.projects.findAll();
    return Promise.all(records.map((record) => this.toProject(record.id)));
  }

  async getById(id: string): Promise<Project | null> {
    const record = await this.projects.findById(id);
    if (!record) return null;
    return this.toProject(id);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const data = createProjectInputSchema.parse(input);
    const workspacePath = this.assertAllowedWorkspacePath(data.workspacePath);
    const now = new Date().toISOString();
    const id = randomUUID();

    await this.projects.insert({
      id,
      name: data.name.trim(),
      baseUrl: data.baseUrl,
      workspacePath,
      status: "created",
      createdAt: now,
      updatedAt: now,
    });
    await this.workflowStates.insertInitial(id);

    return this.toProject(id);
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const data = updateProjectInputSchema.parse(input);
    const current = await this.projects.findById(id);
    if (!current) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${id}`, 404);
    }

    const workspacePath = data.workspacePath
      ? this.assertAllowedWorkspacePath(data.workspacePath)
      : current.workspacePath;

    const updated = {
      ...current,
      name: data.name?.trim() ?? current.name,
      baseUrl: data.baseUrl ?? current.baseUrl,
      workspacePath,
      status: data.status ?? current.status,
      updatedAt: new Date().toISOString(),
    };

    await this.projects.update(updated);
    return this.toProject(id);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.projects.delete(id);
    if (!deleted) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${id}`, 404);
    }
  }

  private async toProject(id: string): Promise<Project> {
    const record = await this.projects.findById(id);
    if (!record) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${id}`, 404);
    }
    const workflow = await this.workflowStates.findByProjectId(id);
    return projectSchema.parse({
      id: record.id,
      name: record.name,
      baseUrl: record.baseUrl,
      workspacePath: record.workspacePath,
      status: record.status,
      workflowStage: workflow?.stage ?? "init",
      stageStatus: workflow?.stageStatus ?? "idle",
      moduleName: workflow?.moduleName ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
