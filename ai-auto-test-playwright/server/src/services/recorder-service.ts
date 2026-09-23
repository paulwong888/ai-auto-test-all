import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { query } from "../db/pool.js";
import { AppError } from "../errors.js";
import Dockerode from "dockerode";
import { WorkflowStateRepository } from "../repositories/workflow-state-repository.js";
import { normalizeModuleName } from "../utils/module-name.js";
import type { ProjectService } from "./project-service.js";

interface MountInfo {
  Destination?: string;
  Source?: string;
}

interface DockerInspectClient {
  listContainers(options: { all?: boolean }): Promise<Array<{ Id: string; Names: string[] }>>;
  getContainer(id: string): {
    inspect(): Promise<{ Mounts?: MountInfo[]; State?: { Running?: boolean } }>;
    stop(options?: { t?: number }): Promise<void>;
  };
}

const MAX_GLOBAL = Number(process.env.RECORDER_MAX_GLOBAL ?? 5);
const MAX_PER_PROJECT = Number(process.env.RECORDER_MAX_PER_PROJECT ?? 1);
const IDLE_MS = Number(process.env.RECORDER_IDLE_MS ?? 30 * 60 * 1000);

interface SessionRow {
  id: string;
  project_id: string;
  module_name: string;
  container_id: string | null;
  vnc_port: number | null;
  status: string;
  target_url: string;
  output_path: string | null;
}

export class RecorderService {
  private docker: Dockerode | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private hostProjectsRoot: string | null = null;
  private readonly workflowStates = new WorkflowStateRepository();

  constructor(private readonly projectService: ProjectService) {
    void this.initDocker();
    this.idleTimer = setInterval(() => void this.cleanupIdle(), 60_000);
  }

  private async initDocker(): Promise<void> {
    try {
      this.docker = new Dockerode({ socketPath: "/var/run/docker.sock" });
    } catch {
      this.docker = null;
    }
  }

  async reconcileStaleSessions(projectId?: string): Promise<void> {
    const result = projectId
      ? await query<SessionRow>(
          `SELECT * FROM recorder_sessions WHERE project_id = $1 AND status IN ('starting','active')`,
          [projectId],
        )
      : await query<SessionRow>(
          `SELECT * FROM recorder_sessions WHERE status IN ('starting','active')`,
        );

    for (const row of result.rows) {
      const stale = !row.container_id || !(await this.isContainerRunning(row.container_id));
      if (!stale) continue;
      await query(
        `UPDATE recorder_sessions SET status = 'stopped', stopped_at = NOW()
         WHERE id = $1 AND status IN ('starting','active')`,
        [row.id],
      );
    }
  }

  private async isContainerRunning(containerId: string): Promise<boolean> {
    if (!this.docker) return false;
    try {
      const docker = this.docker as unknown as DockerInspectClient;
      const inspect = await docker.getContainer(containerId).inspect();
      return inspect.State?.Running === true;
    } catch {
      return false;
    }
  }

  async startSession(projectId: string, moduleNameRaw: string, targetUrl: string) {
    const moduleName = normalizeModuleName(moduleNameRaw);
    await this.reconcileStaleSessions(projectId);

    const activeForProject = await query<SessionRow>(
      `SELECT * FROM recorder_sessions WHERE project_id = $1 AND status IN ('starting','active')`,
      [projectId],
    );
    for (const row of activeForProject.rows) {
      await this.stopSession(projectId, row.id).catch(() => undefined);
    }

    await this.reconcileStaleSessions();

    const global = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM recorder_sessions WHERE status IN ('starting','active')`,
    );
    if (Number(global.rows[0]?.count ?? 0) >= MAX_GLOBAL) {
      throw new AppError("RECORDER_CAPACITY", "Global recorder session limit reached", 503);
    }
    const perProject = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM recorder_sessions WHERE project_id = $1 AND status IN ('starting','active')`,
      [projectId],
    );
    if (Number(perProject.rows[0]?.count ?? 0) >= MAX_PER_PROJECT) {
      throw new AppError("RECORDER_PROJECT_LIMIT", "Project recorder session limit reached", 503);
    }

    const project = await this.projectService.getById(projectId);
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "Project not found", 404);

    const sessionId = randomUUID();
    const outputPath = `tests/recorded/${moduleName}.py`;
    let containerId: string | null = null;
    let vncPort: number | null = null;

    if (this.docker) {
      const hostWorkspace = await this.hostWorkspacePath(project.workspacePath);
      const container = await this.docker.createContainer({
        Image: process.env.RECORDER_IMAGE ?? "ai-auto-test-playwright-recorder:latest",
        Env: [
          `TARGET_URL=${targetUrl}`,
          `MODULE_NAME=${moduleName}`,
          `OUTPUT_PATH=/workspace/${outputPath}`,
          "IGNORE_HTTPS_ERRORS=1",
          ...(process.env.RECORDER_DISPLAY_WIDTH
            ? [`RECORDER_DISPLAY_WIDTH=${process.env.RECORDER_DISPLAY_WIDTH}`]
            : []),
          ...(process.env.RECORDER_DISPLAY_HEIGHT
            ? [`RECORDER_DISPLAY_HEIGHT=${process.env.RECORDER_DISPLAY_HEIGHT}`]
            : []),
          ...(process.env.RECORDER_VIEWPORT_SIZE
            ? [`RECORDER_VIEWPORT_SIZE=${process.env.RECORDER_VIEWPORT_SIZE}`]
            : []),
        ],
        HostConfig: {
          Binds: [`${hostWorkspace}:/workspace`],
          PortBindings: { "6080/tcp": [{ HostPort: "0" }] },
          AutoRemove: true,
        },
        ExposedPorts: { "6080/tcp": {} },
      });
      await container.start();
      containerId = container.id;
      const inspect = await container.inspect();
      const portMap = inspect.NetworkSettings.Ports?.["6080/tcp"];
      vncPort = portMap?.[0]?.HostPort ? Number(portMap[0].HostPort) : null;
    }

    await query(
      `INSERT INTO recorder_sessions
         (id, project_id, module_name, container_id, vnc_port, status, target_url, output_path)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`,
      [sessionId, projectId, moduleName, containerId, vncPort, targetUrl, outputPath],
    );

    return {
      sessionId,
      vncPort,
      vncUrl: `/api/projects/${projectId}/record/${sessionId}/vnc`,
      outputPath,
    };
  }

  async stopSession(projectId: string, sessionId: string) {
    const result = await query<SessionRow>(
      `SELECT * FROM recorder_sessions WHERE id = $1 AND project_id = $2`,
      [sessionId, projectId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError("SESSION_NOT_FOUND", "Recorder session not found", 404);

    if (row.status === "stopped") {
      return { sessionId, outputPath: row.output_path };
    }

    if (this.docker && row.container_id) {
      try {
        const container = this.docker.getContainer(row.container_id);
        await container.stop({ t: 5 });
      } catch {
        // container may already be gone
      }
    }

    await query(
      `UPDATE recorder_sessions SET status = 'stopped', stopped_at = NOW() WHERE id = $1`,
      [sessionId],
    );

    if (row.output_path) {
      await this.markRecordedIfPresent(projectId, row.module_name, row.output_path);
    }

    return { sessionId, outputPath: row.output_path };
  }

  private async markRecordedIfPresent(
    projectId: string,
    moduleName: string,
    outputPath: string,
  ): Promise<void> {
    const project = await this.projectService.getById(projectId);
    if (!project) return;

    const absPath = path.join(project.workspacePath, outputPath);
    try {
      await fs.access(absPath);
    } catch {
      return;
    }

    await this.workflowStates.update(projectId, {
      stage: "recorded",
      stageStatus: "idle",
      moduleName,
      artifactPaths: { recorded: outputPath.split(path.sep).join("/") },
    });
  }

  async getSession(projectId: string, sessionId: string) {
    const result = await query<SessionRow>(
      `SELECT * FROM recorder_sessions WHERE id = $1 AND project_id = $2`,
      [sessionId, projectId],
    );
    return result.rows[0] ?? null;
  }

  async touchSession(sessionId: string): Promise<void> {
    await query(`UPDATE recorder_sessions SET last_activity_at = NOW() WHERE id = $1`, [sessionId]);
  }

  private async resolveHostProjectsRoot(): Promise<string> {
    if (this.hostProjectsRoot) return this.hostProjectsRoot;

    const envHost = process.env.PROJECTS_DATA_HOST_PATH;
    if (envHost && path.isAbsolute(envHost)) {
      this.hostProjectsRoot = envHost;
      return envHost;
    }

    if (this.docker) {
      const docker = this.docker as unknown as DockerInspectClient;
      const hostname = process.env.HOSTNAME ?? "";
      const containers = await docker.listContainers({ all: true });
      const self = containers.find(
        (c) => c.Id.startsWith(hostname) || c.Names.some((n) => n.includes("server")),
      );
      if (self) {
        const inspect = await docker.getContainer(self.Id).inspect();
        const mount = inspect.Mounts?.find((m) => m.Destination === "/data/projects");
        if (mount?.Source) {
          this.hostProjectsRoot = mount.Source;
          return mount.Source;
        }
      }
    }

    const containerRoot = process.env.PROJECTS_DATA_PATH ?? "/data/projects";
    this.hostProjectsRoot = envHost ? path.resolve(envHost) : containerRoot;
    return this.hostProjectsRoot;
  }

  private async hostWorkspacePath(containerWorkspacePath: string): Promise<string> {
    const containerRoot = process.env.PROJECTS_DATA_PATH ?? "/data/projects";
    const hostRoot = await this.resolveHostProjectsRoot();
    if (containerWorkspacePath === containerRoot) return hostRoot;
    if (containerWorkspacePath.startsWith(`${containerRoot}/`)) {
      return `${hostRoot}${containerWorkspacePath.slice(containerRoot.length)}`;
    }
    return containerWorkspacePath;
  }

  private async cleanupIdle(): Promise<void> {
    const result = await query<SessionRow>(
      `SELECT * FROM recorder_sessions
       WHERE status = 'active' AND last_activity_at < NOW() - ($1 || ' milliseconds')::interval`,
      [String(IDLE_MS)],
    );
    for (const row of result.rows) {
      await this.stopSession(row.project_id, row.id).catch(() => undefined);
    }
  }
}
