import { randomUUID } from "node:crypto";
import { Client, Connection } from "@temporalio/client";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import {
  PLATFORM_PROGRESS_QUERY,
  PLAYWRIGHT_PLATFORM_TASK_QUEUE,
  PLAYWRIGHT_PLATFORM_WORKFLOW_NAME,
  type PlatformPipelineInput,
  type PlatformProgress,
} from "../temporal/workflow-constants.js";
import {
  PlatformPipelineRepository,
  type PlatformPipelineRunRecord,
} from "../repositories/platform-pipeline-repository.js";
import type { ProjectService } from "./project-service.js";
import { wsHub } from "../ws/ws-hub.js";

let temporalClient: Client | null = null;

async function getTemporalClient(config: AppConfig): Promise<Client> {
  if (temporalClient) return temporalClient;
  const connection = await Connection.connect({ address: config.temporal.address });
  temporalClient = new Client({
    connection,
    namespace: config.temporal.namespace,
  });
  return temporalClient;
}

export interface StartPlatformPipelineOptions {
  moduleName?: string;
  runPreset?: "ci" | "debug";
  nodeIds?: string[];
  autoFix?: boolean;
  maxFixIterations?: number;
  skipPlan?: boolean;
  skipCodegen?: boolean;
}

export class PlatformPipelineService {
  private readonly pipelineRuns = new PlatformPipelineRepository();

  constructor(
    private readonly config: AppConfig,
    private readonly projectService: ProjectService,
  ) {}

  async checkTemporal(): Promise<boolean> {
    try {
      await getTemporalClient(this.config);
      return true;
    } catch {
      return false;
    }
  }

  async startPlatformPipeline(
    projectId: string,
    options: StartPlatformPipelineOptions = {},
  ): Promise<PlatformPipelineRunRecord> {
    const project = await this.projectService.getById(projectId);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`, 404);
    }

    const moduleName = options.moduleName?.trim() || project.moduleName;
    if (!moduleName) {
      throw new AppError("MODULE_REQUIRED", "moduleName is required", 422);
    }

    const pipelineRunId = randomUUID();
    const workflowId = `playwright-${projectId}-${pipelineRunId}`;
    const now = new Date().toISOString();

    const record: PlatformPipelineRunRecord = {
      id: pipelineRunId,
      projectId,
      temporalWorkflowId: workflowId,
      status: "running",
      currentStage: "starting",
      moduleName,
      runId: null,
      fixIteration: 0,
      options: options as Record<string, unknown>,
      error: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
    };
    await this.pipelineRuns.insert(record);

    const input: PlatformPipelineInput = {
      projectId,
      pipelineRunId,
      moduleName,
      runPreset: options.runPreset ?? "ci",
      nodeIds: options.nodeIds,
      autoFix: options.autoFix ?? true,
      maxFixIterations: options.maxFixIterations ?? 3,
      skipPlan: options.skipPlan ?? true,
      skipCodegen: options.skipCodegen ?? true,
    };

    const temporal = await getTemporalClient(this.config);
    await temporal.workflow.start(PLAYWRIGHT_PLATFORM_WORKFLOW_NAME, {
      taskQueue: PLAYWRIGHT_PLATFORM_TASK_QUEUE,
      workflowId,
      args: [input],
    });

    wsHub.broadcast({
      type: "pipeline_started",
      pipelineRunId,
      projectId,
      temporalWorkflowId: workflowId,
    });

    return record;
  }

  async getPlatformPipeline(
    projectId: string,
    pipelineRunId: string,
  ): Promise<PlatformPipelineRunRecord & { temporalProgress?: PlatformProgress | null }> {
    const record = await this.pipelineRuns.findById(pipelineRunId);
    if (!record || record.projectId !== projectId) {
      throw new AppError("PIPELINE_NOT_FOUND", `Pipeline run not found: ${pipelineRunId}`, 404);
    }

    let temporalProgress: PlatformProgress | null = null;
    try {
      const temporal = await getTemporalClient(this.config);
      const handle = temporal.workflow.getHandle(record.temporalWorkflowId);
      temporalProgress = await handle.query(PLATFORM_PROGRESS_QUERY);
    } catch {
      temporalProgress = null;
    }

    return { ...record, temporalProgress };
  }

  async listPlatformPipelines(projectId: string): Promise<PlatformPipelineRunRecord[]> {
    return this.pipelineRuns.listByProject(projectId);
  }

  async cancelPlatformPipeline(projectId: string, pipelineRunId: string): Promise<void> {
    const record = await this.pipelineRuns.findById(pipelineRunId);
    if (!record || record.projectId !== projectId) {
      throw new AppError("PIPELINE_NOT_FOUND", `Pipeline run not found: ${pipelineRunId}`, 404);
    }
    const temporal = await getTemporalClient(this.config);
    const handle = temporal.workflow.getHandle(record.temporalWorkflowId);
    await handle.cancel();
    await this.pipelineRuns.update(pipelineRunId, {
      status: "cancelled",
      currentStage: "done",
      finishedAt: new Date().toISOString(),
    });
  }

  getRepository(): PlatformPipelineRepository {
    return this.pipelineRuns;
  }
}
