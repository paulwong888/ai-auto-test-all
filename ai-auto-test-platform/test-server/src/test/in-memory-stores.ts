import type { Project } from "../schemas/project.js";
import type { RunHistoryEntry } from "../services/run-history-service.types.js";

export class InMemoryProjectStore {
  private readonly projects = new Map<string, Project>();

  async count(): Promise<number> {
    return this.projects.size;
  }

  async findAll(): Promise<Project[]> {
    return [...this.projects.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async findByRepoPath(repoPath: string): Promise<Project | null> {
    for (const project of this.projects.values()) {
      if (project.repoPath === repoPath) return project;
    }
    return null;
  }

  async insert(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }

  async update(project: Project): Promise<void> {
    if (!this.projects.has(project.id)) throw new Error(`Project not found: ${project.id}`);
    this.projects.set(project.id, project);
  }

  async delete(id: string): Promise<boolean> {
    return this.projects.delete(id);
  }

  async upsert(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }
}

export class InMemoryRunHistoryStore {
  private readonly entries = new Map<string, RunHistoryEntry>();

  private key(projectId: string, featureId: string): string {
    return `${projectId}::${featureId}`;
  }

  async getLastFailedRun(projectId: string, featureId: string): Promise<RunHistoryEntry | null> {
    const entry = this.entries.get(this.key(projectId, featureId));
    if (!entry || entry.lastSuccess) return null;
    return entry;
  }

  async upsert(projectId: string, featureId: string, entry: RunHistoryEntry): Promise<void> {
    this.entries.set(this.key(projectId, featureId), entry);
  }
}
