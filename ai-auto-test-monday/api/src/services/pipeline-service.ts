import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { Connection, Client } from "@temporalio/client";
import {
  WORKFLOW_NAME,
  TASK_QUEUE,
  PROGRESS_QUERY,
  artifactRoot as buildArtifactRoot,
  resolveProjectPaths,
} from "@monday/agent-core";
import type { PipelineProgress } from "@monday/agent-core/workflow";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { getProject } from "./project-service.js";

let client: Client | null = null;

async function getTemporalClient(): Promise<Client> {
  if (client) return client;
  const connection = await Connection.connect({
    address: config.temporalAddress,
  });
  client = new Client({
    connection,
    namespace: config.temporalNamespace,
  });
  return client;
}

export async function checkTemporal(): Promise<boolean> {
  try {
    await getTemporalClient();
    return true;
  } catch {
    return false;
  }
}

export async function startPipeline(projectId: string): Promise<{
  runId: string;
  workflowId: string;
  artifactRoot: string;
}> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const paths = resolveProjectPaths(config.reposBaseDir, project);

  if (project.cloneStatus !== "ready") {
    throw new Error("Frontend path not ready; clone project first");
  }

  const frontendPath =
    project.frontendRepoPath?.trim() || paths.frontendPath;

  try {
    await access(frontendPath, constants.F_OK);
  } catch {
    throw new Error(
      `Frontend path not ready; clone project first (${frontendPath})`,
    );
  }

  let backendPath: string | undefined;
  if (paths.backendPath) {
    const resolvedBackend =
      project.backendRepoPath?.trim() || paths.backendPath;
    try {
      await access(resolvedBackend, constants.F_OK);
      backendPath = resolvedBackend;
    } catch {
      // backend optional until cloned
    }
  }

  const runId = randomUUID();
  const workflowId = `pipeline-${projectId}-${runId}`;
  const root = buildArtifactRoot(config.artifactsBaseDir, projectId, runId);

  await pool.query(
    `INSERT INTO pipeline_runs (id, project_id, temporal_workflow_id, status, artifact_root)
     VALUES ($1, $2, $3, 'running', $4)`,
    [runId, projectId, workflowId, root],
  );

  const temporal = await getTemporalClient();
  await temporal.workflow.start(WORKFLOW_NAME, {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [
      {
        projectId,
        runId,
        artifactRoot: root,
        frontendPath,
        backendPath,
        targetUrl: project.targetUrl ?? undefined,
      },
    ],
  });

  return { runId, workflowId, artifactRoot: root };
}

export async function getPipelineRun(runId: string): Promise<{
  run: Record<string, unknown>;
  progress: PipelineProgress | null;
}> {
  const { rows } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1",
    [runId],
  );
  const run = rows[0];
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  let progress: PipelineProgress | null = null;
  try {
    const temporal = await getTemporalClient();
    const handle = temporal.workflow.getHandle(String(run.temporal_workflow_id));
    progress = await handle.query(PROGRESS_QUERY);

    if (progress?.status === "completed" && !run.finished_at) {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'completed', current_agent = NULL, finished_at = NOW() WHERE id = $1`,
        [runId],
      );
    }
    if (progress?.status === "failed") {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1`,
        [runId, progress.error ?? "workflow failed"],
      );
    } else if (progress?.currentAgent) {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'running', current_agent = $2 WHERE id = $1`,
        [runId, progress.currentAgent],
      );
    }
  } catch {
    // workflow may still be starting
  }

  const { rows: updated } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1",
    [runId],
  );

  return { run: updated[0] ?? run, progress };
}

export async function listRuns(projectId?: string): Promise<unknown[]> {
  if (projectId) {
    const { rows } = await pool.query(
      "SELECT * FROM pipeline_runs WHERE project_id = $1 ORDER BY started_at DESC LIMIT 20",
      [projectId],
    );
    return rows;
  }
  const { rows } = await pool.query(
    "SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 20",
  );
  return rows;
}
