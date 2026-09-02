import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import {
  createProjectInputSchema,
  projectSchema,
  slugify,
  uniqueProjectId,
  updateProjectInputSchema,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from "../schemas/project.js";
import { ProjectRepository } from "../repositories/project-repository.js";
import { ProjectEnvService } from "./project-env-service.js";

export interface ResolvedProject {
  id: string;
  name: string;
  repoPath: string;
  targetUrl: string;
  auditProfile?: string;
  authMode: "none" | "keycloak";
}

export interface ProjectValidation {
  ok: boolean;
  repoExists: boolean;
  hasPiConfig: boolean;
  hasE2eDir: boolean;
  hasPlaywrightConfig: boolean;
  hasAuthSetup: boolean;
  hasEnvE2e: boolean;
  playwrightListOk: boolean;
  messages: string[];
}

export type ProjectStore = ProjectRepository;

export class ProjectService {
  private readonly envService: ProjectEnvService;
  private readonly store: ProjectStore;

  constructor(
    private readonly config: AppConfig,
    store?: ProjectStore,
  ) {
    this.envService = new ProjectEnvService(config);
    this.store = store ?? new ProjectRepository();
  }

  async init(): Promise<void> {
    const count = await this.store.count();
    if (count === 0) {
      await this.seedDefaultProject();
    }
  }

  async list(): Promise<Project[]> {
    return this.store.findAll();
  }

  async getById(id: string): Promise<Project | null> {
    return this.store.findById(id);
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
      authMode: project.authMode ?? "none",
    };
  }

  async resolveIdByRepoPath(repoPath: string): Promise<string | null> {
    const normalized = this.normalizeRepoPath(repoPath);
    const project = await this.store.findByRepoPath(normalized);
    return project?.id ?? null;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const data = createProjectInputSchema.parse(input);
    const repoPath = this.normalizeRepoPath(data.repoPath);
    this.assertAllowedRepoPath(repoPath);

    const projects = await this.store.findAll();
    const baseId = slugify(data.name);
    const id = uniqueProjectId(baseId, new Set(projects.map((p) => p.id)));
    const now = new Date().toISOString();

    const project = projectSchema.parse({
      id,
      name: data.name.trim(),
      repoPath,
      targetUrl: data.targetUrl,
      auditProfile: data.auditProfile,
      authMode: data.authMode ?? "none",
      createdAt: now,
      updatedAt: now,
    });

    await this.store.insert(project);
    return project;
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const data = updateProjectInputSchema.parse(input);
    const current = await this.store.findById(id);
    if (!current) {
      throw new Error(`Project not found: ${id}`);
    }

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
      authMode: data.authMode ?? current.authMode ?? "none",
      updatedAt: new Date().toISOString(),
    });

    await this.store.update(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.store.delete(id);
    if (!deleted) {
      throw new Error(`Project not found: ${id}`);
    }
  }

  async validate(id: string): Promise<ProjectValidation> {
    const project = await this.resolve(id);
    const messages: string[] = [];
    let repoExists = false;
    let hasPiConfig = false;
    let hasE2eDir = false;
    let hasPlaywrightConfig = false;
    let hasAuthSetup = false;
    let hasEnvE2e = false;
    let playwrightListOk = false;

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
      try {
        await fs.access(path.join(project.repoPath, "playwright.config.ts"));
        hasPlaywrightConfig = true;
      } catch {
        messages.push("缺少 playwright.config.ts");
      }

      if (project.authMode === "keycloak") {
        try {
          await fs.access(path.join(project.repoPath, "tests/e2e/auth.setup.ts"));
          hasAuthSetup = true;
        } catch {
          messages.push("Keycloak 模式缺少 tests/e2e/auth.setup.ts");
        }
        try {
          await fs.access(path.join(project.repoPath, ".env.e2e"));
          hasEnvE2e = true;
        } catch {
          messages.push("Keycloak 模式缺少 .env.e2e（請在初始化模板時填寫 SSO 帳密）");
        }
        messages.push(
          "請確認 targetUrl 已在 Keycloak 客戶端登記為合法 redirect_uri",
        );
      } else {
        hasAuthSetup = true;
        hasEnvE2e = true;
      }

      if (hasPlaywrightConfig && hasE2eDir) {
        const envCheck = await this.envService.ensureTestEnv(
          project.repoPath,
          project.targetUrl,
        );
        playwrightListOk = envCheck.ok;
        if (!envCheck.ok) {
          messages.push(envCheck.message);
        }
      }
    }

    const baseOk =
      repoExists && hasPiConfig && hasE2eDir && hasPlaywrightConfig && hasAuthSetup && hasEnvE2e;

    return {
      ok: baseOk && playwrightListOk,
      repoExists,
      hasPiConfig,
      hasE2eDir,
      hasPlaywrightConfig,
      hasAuthSetup,
      hasEnvE2e,
      playwrightListOk,
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
    await this.store.insert(project);
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
}
