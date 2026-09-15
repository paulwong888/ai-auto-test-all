import type { FeaturesDocument } from "./journeys-to-features.js";

export interface PlatformProject {
  id: string;
  name: string;
  repoPath: string;
  targetUrl: string;
}

export interface PlatformRunResult {
  ok: boolean;
  runId?: string;
  error?: string;
}

export interface PlatformRunStatus {
  ok: boolean;
  running: boolean;
  activeRun?: {
    runId: string;
    featureId: string;
    title: string;
    startedAt: string;
    logs: Array<{ stream: string; text: string }>;
  } | null;
}

export class PlatformClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    const raw = await res.text();
    let data: T & { ok?: boolean; error?: string };
    try {
      data = JSON.parse(raw) as T & { ok?: boolean; error?: string };
    } catch {
      throw new Error(
        `Platform ${method} ${path} failed (${res.status}): ${raw.slice(0, 200)}`,
      );
    }
    if (!res.ok || data.ok === false) {
      throw new Error(
        (data as { error?: string }).error ??
          `Platform ${method} ${path} failed (${res.status})`,
      );
    }
    return data;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listProjects(): Promise<PlatformProject[]> {
    const data = await this.request<{ projects: PlatformProject[] }>("GET", "/api/projects");
    return data.projects ?? [];
  }

  async ensureProject(input: {
    id: string;
    name: string;
    repoPath: string;
    targetUrl: string;
  }): Promise<PlatformProject> {
    const existing = await this.listProjects();
    const found = existing.find(
      (p) =>
        p.id === input.id ||
        p.repoPath === input.repoPath ||
        (input.id === "demo" && p.id === "demo-app") ||
        p.repoPath.endsWith("/demo-app"),
    );
    if (found) return found;

    const created = await this.request<{ project: PlatformProject }>(
      "POST",
      "/api/projects",
      {
        name: input.name,
        repoPath: input.repoPath,
        targetUrl: input.targetUrl,
      },
    );
    return created.project;
  }

  async initTemplate(projectId: string): Promise<void> {
    await this.request("POST", `/api/projects/${projectId}/init-template`, {});
  }

  async validateProject(projectId: string): Promise<{ ok: boolean; messages?: string[] }> {
    const data = await this.request<{
      validation: { ok: boolean; messages: string[] };
    }>("POST", `/api/projects/${projectId}/validate`, {});
    return data.validation;
  }

  async importFeatures(projectId: string, doc: FeaturesDocument): Promise<void> {
    await this.request("POST", `/api/projects/${projectId}/features/import`, doc);
  }

  async runFeature(projectId: string, featureId: string): Promise<PlatformRunResult> {
    return this.request<PlatformRunResult>("POST", "/api/run", {
      projectId,
      featureId,
    });
  }

  async getRunStatus(): Promise<PlatformRunStatus> {
    return this.request<PlatformRunStatus>("GET", "/api/run/status");
  }

  async waitForRunComplete(pollMs = 3000, timeoutMs = 900_000): Promise<{
    success: boolean;
    message: string;
  }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getRunStatus();
      if (!status.running) {
        const logs = status.activeRun?.logs ?? [];
        const last = logs[logs.length - 1]?.text ?? "Run finished";
        const success = !last.toLowerCase().includes("fail");
        return { success, message: last };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return { success: false, message: "Platform run timeout" };
  }
}

/** Map Monday container path to platform-allowed repo path. */
export function mapRepoPathForPlatform(mondayPath: string): string {
  if (mondayPath.startsWith("/data/repos/sandbox/")) {
    const rel = mondayPath.slice("/data/repos/sandbox/".length);
    return `/app/sandbox-repos/${rel}`;
  }
  return mondayPath;
}
