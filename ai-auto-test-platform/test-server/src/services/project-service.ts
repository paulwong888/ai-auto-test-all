import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  createProjectInputSchema,
  projectSchema,
  projectsFileSchema,
  slugify,
  uniqueProjectId,
  updateProjectInputSchema,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from "../schemas/project.js";

export interface ResolvedProject {
  id: string;
  name: string;
  repoPath: string;
  targetUrl: string;
  auditProfile?: string;
}

export interface ProjectValidation {
  ok: boolean;
  repoExists: boolean;
  hasPiConfig: boolean;
  hasE2eDir: boolean;
  messages: string[];
}

export class ProjectService {
  private cache: Project[] | null = null;

  constructor(private readonly config: AppConfig) {}

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.config.projectsFile), { recursive: true });
    try {
      await fs.access(this.config.projectsFile);
      await this.loadAll();
    } catch {
      await this.seedDefaultProject();
    }
  }

  async list(): Promise<Project[]> {
    return this.loadAll();
  }

  async getById(id: string): Promise<Project | null> {
    const projects = await this.loadAll();
    return projects.find((p) => p.id === id) ?? null;
  }

  async resolve(projectId: string): Promise<ResolvedProject> {
    const project = await this.getById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return {
      id: project.id,
      name: project.name,
      repoPath: path.resolve(project.repoPath),
      targetUrl: project.targetUrl,
      auditProfile: project.auditProfile,
    };
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const data = createProjectInputSchema.parse(input);
    const repoPath = this.normalizeRepoPath(data.repoPath);
    this.assertAllowedRepoPath(repoPath);

    const projects = await this.loadAll();
    const baseId = slugify(data.name);
    const id = uniqueProjectId(baseId, new Set(projects.map((p) => p.id)));
    const now = new Date().toISOString();

    const project = projectSchema.parse({
      id,
      name: data.name.trim(),
      repoPath,
      targetUrl: data.targetUrl,
      auditProfile: data.auditProfile,
      createdAt: now,
      updatedAt: now,
    });

    projects.push(project);
    await this.saveAll(projects);
    return project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const data = updateProjectInputSchema.parse(input);
    const projects = await this.loadAll();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error(`Project not found: ${id}`);
    }

    const current = projects[idx]!;
    const repoPath = data.repoPath
      ? this.normalizeRepoPath(data.repoPath)
      : current.repoPath;
    if (data.repoPath) {
      this.assertAllowedRepoPath(repoPath);
    }

    const updated = projectSchema.parse({
      ...current,
      name: data.name?.trim() ?? current.name,
      repoPath,
      targetUrl: data.targetUrl ?? current.targetUrl,
      auditProfile: data.auditProfile ?? current.auditProfile,
      updatedAt: new Date().toISOString(),
    });

    projects[idx] = updated;
    await this.saveAll(projects);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const projects = await this.loadAll();
    const next = projects.filter((p) => p.id !== id);
    if (next.length === projects.length) {
      throw new Error(`Project not found: ${id}`);
    }
    await this.saveAll(next);
  }

  async validate(id: string): Promise<ProjectValidation> {
    const project = await this.resolve(id);
    const messages: string[] = [];
    let repoExists = false;
    let hasPiConfig = false;
    let hasE2eDir = false;

    try {
      await fs.access(project.repoPath);
      repoExists = true;
    } catch {
      messages.push(`原始碼路徑不存在: ${project.repoPath}`);
    }

    if (repoExists) {
      try {
        await fs.access(path.join(project.repoPath, ".pi"));
        hasPiConfig = true;
      } catch {
        messages.push("缺少 .pi/ 設定目錄");
      }
      try {
        await fs.access(path.join(project.repoPath, "tests/e2e"));
        hasE2eDir = true;
      } catch {
        messages.push("缺少 tests/e2e/ 目錄");
      }
    }

    return {
      ok: repoExists && hasPiConfig && hasE2eDir,
      repoExists,
      hasPiConfig,
      hasE2eDir,
      messages,
    };
  }

  getAllowedPrefixes(): string[] {
    return [...this.config.allowedRepoPrefixes];
  }

  private async seedDefaultProject(): Promise<void> {
    const now = new Date().toISOString();
    const project = projectSchema.parse({
      id: "demo-app",
      name: "Demo App",
      repoPath: this.normalizeRepoPath(this.config.defaultSandboxRepo),
      targetUrl: this.config.defaultTargetAppUrl,
      createdAt: now,
      updatedAt: now,
    });
    await this.saveAll([project]);
  }

  private normalizeRepoPath(repoPath: string): string {
    return path.resolve(repoPath);
  }

  private assertAllowedRepoPath(repoPath: string): void {
    const normalized = this.normalizeRepoPath(repoPath);
    const allowed = this.config.allowedRepoPrefixes.some((prefix) => {
      const resolvedPrefix = path.resolve(prefix);
      return (
        normalized === resolvedPrefix ||
        normalized.startsWith(resolvedPrefix + path.sep)
      );
    });
    if (!allowed) {
      throw new Error(
        `repoPath must be under allowed prefixes: ${this.config.allowedRepoPrefixes.join(", ")}`,
      );
    }
  }

  private async loadAll(): Promise<Project[]> {
    if (this.cache) return this.cache;
    const raw = await fs.readFile(this.config.projectsFile, "utf8");
    const parsed = projectsFileSchema.parse(JSON.parse(raw));
    this.cache = parsed.projects;
    return parsed.projects;
  }

  private async saveAll(projects: Project[]): Promise<void> {
    const payload = projectsFileSchema.parse({ version: "1.0", projects });
    await fs.writeFile(this.config.projectsFile, JSON.stringify(payload, null, 2) + "\n");
    this.cache = projects;
  }
}
