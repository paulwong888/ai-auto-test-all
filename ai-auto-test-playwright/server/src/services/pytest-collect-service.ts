import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";
import type { ProjectService } from "./project-service.js";
import { PYTEST_BIN } from "./pytest-runner.js";

export interface CollectedTestItem {
  nodeId: string;
  name: string;
  tc: string | null;
}

interface WorkerCollectResponse {
  ok?: boolean;
  items?: CollectedTestItem[];
  error?: string;
  output?: string;
}

export class PytestCollectService {
  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
  ) {}

  async collectForProject(projectId: string): Promise<{ items: CollectedTestItem[]; total: number }> {
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }

    const command = [
      `cd ${shellQuote(`${project.workspacePath}/tests`)}`,
      "&&",
      PYTEST_BIN,
      "specs/",
      "--collect-only",
      "-qq",
    ].join(" ");

    let response: Response;
    try {
      response = await fetch(`${this.config.workerUrl}/internal/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError("WORKER_UNAVAILABLE", `Worker collect failed: ${message}`, 503);
    }

    const payload = (await response.json()) as WorkerCollectResponse;
    if (!response.ok || !payload.ok || !payload.items) {
      const detail = payload.output ?? payload.error ?? `HTTP ${response.status}`;
      throw new AppError("COLLECT_FAILED", `pytest collect failed: ${detail}`, 502);
    }

    return { items: payload.items, total: payload.items.length };
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
