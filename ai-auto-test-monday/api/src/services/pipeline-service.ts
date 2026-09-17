import { createHash, randomUUID } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import {
  Connection,
  Client,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import {
  WORKFLOW_NAME,
  EXECUTE_WORKFLOW_NAME,
  RESUME_WORKFLOW_NAME,
  TASK_QUEUE,
  PROGRESS_QUERY,
  EXECUTE_PROGRESS_QUERY,
  AGENT_IDS,
  artifactRoot as buildArtifactRoot,
  resolveProjectPaths,
} from "@monday/agent-core";
import type { AgentId, PipelineProgress } from "@monday/agent-core/workflow";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { getProject } from "./project-service.js";
import type { E2eAuthConfig, Project } from "@monday/agent-core";
import { mergeExecuteProgress } from "./pipeline-progress.js";
import { publishRunEvent } from "../ws/hub.js";
import {
  cleanupDownstreamArtifacts,
  downstreamDeletesExecutionReport,
} from "./artifact-cleanup.js";

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

export interface StartPipelineOptions {
  applyTestIds?: boolean;
  executeAfterGenerate?: boolean;
  executionMode?: "auto" | "platform" | "direct";
}

export interface ExecutePipelineOptions {
  executionMode?: "auto" | "platform" | "direct";
  journeyIds?: string[];
}

export interface ResumePipelineOptions {
  fromAgent: AgentId;
  executeAfterGenerate?: boolean;
  executionMode?: "auto" | "platform" | "direct";
  applyTestIds?: boolean;
}

const GENERATION_ARTIFACT_FILES = [
  "component-registry.json",
  "testid-injections.json",
  "locator-catalog.json",
  "journeys.json",
];

async function hasGenerationArtifacts(artifactRoot: string): Promise<boolean> {
  for (const file of GENERATION_ARTIFACT_FILES) {
    try {
      await access(path.join(artifactRoot, file), constants.F_OK);
    } catch {
      return false;
    }
  }
  return true;
}

function requireE2eAuth(
  project: Project,
  executionMode: "auto" | "platform" | "direct",
): void {
  if (executionMode === "platform") return;
  if (!project.e2eAuth?.username || !project.e2eAuth.password) {
    throw new Error(
      "Project E2E credentials not configured; set username and password in project settings",
    );
  }
}

function pipelineE2eAuth(
  project: Project,
): E2eAuthConfig | undefined {
  return project.e2eAuth ?? undefined;
}

async function listSpecFiles(artifactRoot: string): Promise<string[]> {
  const testsDir = path.join(artifactRoot, "tests");
  try {
    return (await readdir(testsDir)).filter((f) => f.endsWith(".spec.ts"));
  } catch {
    return [];
  }
}

function hashJourneyIds(journeyIds: string[]): string {
  return createHash("sha256")
    .update([...journeyIds].sort().join(","))
    .digest("hex")
    .slice(0, 8);
}

async function queryOverlayProgress(
  overlayWorkflowId: string,
): Promise<PipelineProgress | null> {
  try {
    const temporal = await getTemporalClient();
    const handle = temporal.workflow.getHandle(overlayWorkflowId);
    const queryName = overlayWorkflowId.startsWith("execute-")
      ? EXECUTE_PROGRESS_QUERY
      : PROGRESS_QUERY;
    return (await handle.query(queryName)) as PipelineProgress;
  } catch {
    return null;
  }
}

export async function startPipeline(
  projectId: string,
  options: StartPipelineOptions = {},
): Promise<{
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

  const executionMode = options.executionMode ?? "auto";
  const executeAfterGenerate = options.executeAfterGenerate ?? true;
  const applyTestIds = options.applyTestIds ?? false;

  if (executeAfterGenerate) {
    requireE2eAuth(project, executionMode);
  }

  await pool.query(
    `INSERT INTO pipeline_runs (id, project_id, temporal_workflow_id, status, artifact_root, execution_mode, execution_status, execute_after_generate, apply_test_ids)
     VALUES ($1, $2, $3, 'running', $4, $5, $6, $7, $8)`,
    [
      runId,
      projectId,
      workflowId,
      root,
      executionMode,
      executeAfterGenerate ? "pending" : null,
      executeAfterGenerate,
      applyTestIds,
    ],
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
        e2eAuth: pipelineE2eAuth(project),
        applyTestIds,
        executeAfterGenerate,
        executionMode,
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
  const isExecutePhase = run.execution_status != null;
  try {
    const temporal = await getTemporalClient();
    let mainProgress: PipelineProgress | null = null;
    try {
      const handle = temporal.workflow.getHandle(String(run.temporal_workflow_id));
      mainProgress = (await handle.query(PROGRESS_QUERY)) as PipelineProgress;
    } catch {
      // main workflow may be unavailable
    }

    const overlayId = run.overlay_workflow_id
      ? String(run.overlay_workflow_id)
      : null;
    const overlayProgress = overlayId
      ? await queryOverlayProgress(overlayId)
      : null;

    let execProgress: PipelineProgress | null = null;
    if (overlayId?.startsWith("execute-")) {
      execProgress = overlayProgress;
    } else if (isExecutePhase && !overlayId) {
      try {
        const executeHandle = temporal.workflow.getHandle(`execute-${runId}`);
        execProgress = (await executeHandle.query(
          EXECUTE_PROGRESS_QUERY,
        )) as PipelineProgress;
      } catch {
        // execute workflow may not exist yet
      }
    }

    progress = mergeExecuteProgress(mainProgress, execProgress, run);
    if (overlayProgress && overlayId?.startsWith("resume-")) {
      progress = {
        ...overlayProgress,
        executeAfterGenerate: progress?.executeAfterGenerate,
        skippedAgents: overlayProgress.skippedAgents ?? progress?.skippedAgents,
      };
    }

    if (
      overlayId?.startsWith("resume-") &&
      overlayProgress?.status === "completed" &&
      run.status === "running"
    ) {
      // Keep overlay_workflow_id: it points at the workflow that actually
      // drove this run to completion and remains its authoritative progress
      // source (the original main workflow may have failed/been cancelled).
      await pool.query(
        `UPDATE pipeline_runs SET status = 'completed', current_agent = NULL, finished_at = NOW() WHERE id = $1`,
        [runId],
      );
    }
    if (
      overlayId?.startsWith("resume-") &&
      overlayProgress?.status === "failed" &&
      run.status === "running"
    ) {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'failed', current_agent = NULL, error = $2, finished_at = NOW() WHERE id = $1`,
        [runId, overlayProgress.error ?? "resume failed"],
      );
    }

    const generationFinished =
      mainProgress?.status === "completed" ||
      run.finished_at != null ||
      run.status === "completed";

    if (progress?.status === "completed" && !run.finished_at && !isExecutePhase) {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'completed', current_agent = NULL, finished_at = NOW() WHERE id = $1`,
        [runId],
      );
    }
    // When a resume overlay exists it supersedes the original main workflow —
    // never let the old workflow's terminal state (failed/cancelled) leak into
    // the run while the overlay is in charge.
    const resumeOverlayActive = Boolean(overlayId?.startsWith("resume-"));
    // Terminal-propagation below is only valid while the run is still active;
    // once the DB row is terminal, stale workflow queries must not resurrect
    // failures (e.g. the old main workflow of a resumed-then-completed run).
    const runActive = run.status === "running";

    if (
      runActive &&
      !resumeOverlayActive &&
      progress?.status === "cancelled" &&
      run.status !== "cancelled"
    ) {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'cancelled', current_agent = NULL, finished_at = NOW() WHERE id = $1`,
        [runId],
      );
    }
    const generationFailed =
      runActive &&
      (progress?.status === "failed" ||
        (!resumeOverlayActive && mainProgress?.status === "failed"));
    if (generationFailed && run.status !== "failed") {
      const errorMessage =
        mainProgress?.error ??
        progress?.error ??
        "workflow failed";
      await pool.query(
        `UPDATE pipeline_runs SET status = 'failed', error = $2, finished_at = NOW(), current_agent = NULL WHERE id = $1`,
        [runId, errorMessage],
      );
    } else if (
      progress?.currentAgent &&
      !isExecutePhase &&
      !generationFailed &&
      !overlayId
    ) {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'running', current_agent = $2 WHERE id = $1`,
        [runId, progress.currentAgent],
      );
    } else if (overlayId && overlayProgress?.status === "running") {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'running', current_agent = $2 WHERE id = $1`,
        [runId, overlayProgress.currentAgent],
      );
    } else if (isExecutePhase) {
      if (run.execution_status === "running" && progress?.currentAgent) {
        await pool.query(
          `UPDATE pipeline_runs SET current_agent = $2 WHERE id = $1`,
          [runId, progress.currentAgent],
        );
      } else if (
        run.execution_status === "completed" ||
        run.execution_status === "failed"
      ) {
        await pool.query(
          `UPDATE pipeline_runs SET current_agent = NULL WHERE id = $1`,
          [runId],
        );
      }
      if (
        run.execution_status === "failed" &&
        run.status === "running"
      ) {
        await pool.query(
          `UPDATE pipeline_runs SET status = 'failed', finished_at = COALESCE(finished_at, NOW()), current_agent = NULL WHERE id = $1`,
          [runId],
        );
      } else if (
        run.execution_status === "completed" &&
        run.status === "running" &&
        generationFinished
      ) {
        await pool.query(
          `UPDATE pipeline_runs SET status = 'completed', finished_at = COALESCE(finished_at, NOW()), current_agent = NULL WHERE id = $1`,
          [runId],
        );
      } else if (
        generationFinished &&
        run.status === "running" &&
        !generationFailed &&
        !overlayId &&
        run.execution_status !== "failed"
      ) {
        await pool.query(
          `UPDATE pipeline_runs SET status = 'completed', current_agent = NULL WHERE id = $1`,
          [runId],
        );
      }
    }
  } catch {
    progress = mergeExecuteProgress(null, null, run);
  }

  const { rows: updated } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1",
    [runId],
  );

  return { run: updated[0] ?? run, progress };
}

export async function executePipelineRun(
  runId: string,
  options: ExecutePipelineOptions = {},
): Promise<{ workflowId: string }> {
  const { rows } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1",
    [runId],
  );
  const run = rows[0];
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (run.status === "running" || run.execution_status === "running") {
    throw new Error("Pipeline or execution already in progress");
  }

  const project = await getProject(String(run.project_id));
  if (!project) {
    throw new Error(`Project not found: ${run.project_id}`);
  }

  const artifactRoot = String(run.artifact_root);
  const specFiles = await listSpecFiles(artifactRoot);
  if (specFiles.length === 0) {
    throw new Error("No generated spec files; run full pipeline first");
  }

  const generationReady = await hasGenerationArtifacts(artifactRoot);
  const canExecute =
    run.status === "completed" ||
    (specFiles.length > 0 && generationReady);
  if (!canExecute) {
    throw new Error(
      `Run not ready for execute-only (status=${run.status}, artifacts incomplete)`,
    );
  }

  if (options.journeyIds?.length) {
    const specIds = new Set(
      specFiles.map((f) => f.replace(/\.spec\.ts$/, "")),
    );
    const missing = options.journeyIds.filter((id) => !specIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Unknown journeyIds: ${missing.join(", ")}`);
    }
  }

  const paths = resolveProjectPaths(config.reposBaseDir, project);
  const frontendPath =
    project.frontendRepoPath?.trim() || paths.frontendPath;
  try {
    await access(frontendPath, constants.F_OK);
  } catch {
    throw new Error(`Frontend path not ready (${frontendPath})`);
  }

  const executionMode =
    options.executionMode ??
    (run.execution_mode as "auto" | "platform" | "direct" | null) ??
    "auto";

  requireE2eAuth(project, executionMode);

  const workflowId =
    options.journeyIds?.length
      ? `execute-${runId}-partial-${hashJourneyIds(options.journeyIds)}`
      : `execute-${runId}`;

  await pool.query(
    `UPDATE pipeline_runs SET execution_status = 'running', execution_mode = $2, current_agent = 'continuityLead', overlay_workflow_id = $3 WHERE id = $1`,
    [runId, executionMode, workflowId],
  );

  const temporal = await getTemporalClient();
  try {
    await temporal.workflow.start(EXECUTE_WORKFLOW_NAME, {
      taskQueue: TASK_QUEUE,
      workflowId,
      workflowIdReusePolicy:
        WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE,
      args: [
        {
          projectId: String(run.project_id),
          runId,
          artifactRoot,
          frontendPath,
          targetUrl: project.targetUrl ?? undefined,
          e2eAuth: pipelineE2eAuth(project),
          executeAfterGenerate: true,
          executionMode,
          journeyIds: options.journeyIds,
        },
      ],
    });
  } catch (err) {
    await pool.query(
      `UPDATE pipeline_runs SET execution_status = $2, overlay_workflow_id = NULL WHERE id = $1`,
      [runId, run.execution_status ?? null],
    );
    throw err;
  }

  return { workflowId };
}

function resolveResumeExecutionStatus(
  fromAgent: AgentId,
  run: Record<string, unknown>,
  executeAfterGenerate: boolean,
  isGenerationResume: boolean,
): string | null {
  if (fromAgent === "continuityLead") {
    return "running";
  }
  if (isGenerationResume && downstreamDeletesExecutionReport(fromAgent)) {
    return executeAfterGenerate ? "pending" : null;
  }
  return (run.execution_status as string | null) ?? null;
}

export async function resumePipelineRun(
  runId: string,
  options: ResumePipelineOptions,
): Promise<{ workflowId: string }> {
  if (!AGENT_IDS.includes(options.fromAgent)) {
    throw new Error(`Invalid fromAgent: ${options.fromAgent}`);
  }

  const { rows } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1",
    [runId],
  );
  const run = rows[0];
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (run.status === "running" || run.execution_status === "running") {
    throw new Error("Pipeline or execution already in progress");
  }

  const project = await getProject(String(run.project_id));
  if (!project) {
    throw new Error(`Project not found: ${run.project_id}`);
  }

  const artifactRoot = String(run.artifact_root);
  try {
    await access(artifactRoot, constants.F_OK);
  } catch {
    throw new Error(`Artifact root not found: ${artifactRoot}`);
  }

  const paths = resolveProjectPaths(config.reposBaseDir, project);
  const frontendPath =
    project.frontendRepoPath?.trim() || paths.frontendPath;
  try {
    await access(frontendPath, constants.F_OK);
  } catch {
    throw new Error(`Frontend path not ready (${frontendPath})`);
  }

  await cleanupDownstreamArtifacts(artifactRoot, options.fromAgent);

  const executeAfterGenerate =
    options.executeAfterGenerate ??
    (run.execute_after_generate as boolean | null) ??
    true;
  const executionMode =
    options.executionMode ??
    (run.execution_mode as "auto" | "platform" | "direct" | null) ??
    "auto";
  const applyTestIds =
    options.applyTestIds ?? (run.apply_test_ids as boolean | null) ?? false;
  const workflowId = `resume-${runId}-${options.fromAgent}`;
  const isGenerationResume = options.fromAgent !== "continuityLead";

  if (
    options.fromAgent === "continuityLead" ||
    (executeAfterGenerate && isGenerationResume)
  ) {
    requireE2eAuth(project, executionMode);
  }

  const resumeExecutionStatus = resolveResumeExecutionStatus(
    options.fromAgent,
    run,
    executeAfterGenerate,
    isGenerationResume,
  );

  await pool.query(
    `UPDATE pipeline_runs SET
      status = 'running',
      current_agent = $2,
      execution_status = $3,
      execution_mode = $4,
      overlay_workflow_id = $5,
      execute_after_generate = $6,
      apply_test_ids = $7,
      finished_at = NULL,
      error = NULL
     WHERE id = $1`,
    [
      runId,
      options.fromAgent,
      resumeExecutionStatus,
      executionMode,
      workflowId,
      executeAfterGenerate,
      applyTestIds,
    ],
  );

  const temporal = await getTemporalClient();
  try {
    await temporal.workflow.start(RESUME_WORKFLOW_NAME, {
      taskQueue: TASK_QUEUE,
      workflowId,
      workflowIdReusePolicy:
        WorkflowIdReusePolicy.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE,
      args: [
        {
          projectId: String(run.project_id),
          runId,
          artifactRoot,
          frontendPath,
          targetUrl: project.targetUrl ?? undefined,
          e2eAuth: pipelineE2eAuth(project),
          applyTestIds,
          executeAfterGenerate,
          executionMode,
          startFromAgent: options.fromAgent,
        },
      ],
    });
  } catch (err) {
    await pool.query(
      `UPDATE pipeline_runs SET status = $2, current_agent = NULL, overlay_workflow_id = NULL WHERE id = $1`,
      [runId, run.status],
    );
    throw err;
  }

  return { workflowId };
}

async function cancelWorkflowId(
  temporal: Client,
  workflowId: string,
): Promise<void> {
  try {
    await temporal.workflow.getHandle(workflowId).cancel();
  } catch {
    // workflow may already be finished or not exist
  }
}

function workflowIdsForRun(runId: string, run: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  if (run.temporal_workflow_id) ids.add(String(run.temporal_workflow_id));
  if (run.overlay_workflow_id) ids.add(String(run.overlay_workflow_id));
  ids.add(`execute-${runId}`);
  for (const agent of AGENT_IDS) {
    ids.add(`resume-${runId}-${agent}`);
  }
  return [...ids];
}

export async function cancelPipeline(runId: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT * FROM pipeline_runs WHERE id = $1",
    [runId],
  );
  const run = rows[0];
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  if (run.status === "completed") {
    throw new Error(`Run already finished: ${run.status}`);
  }

  const temporal = await getTemporalClient();
  for (const workflowId of workflowIdsForRun(runId, run)) {
    await cancelWorkflowId(temporal, workflowId);
  }

  await pool.query(
    `UPDATE pipeline_runs SET
      status = 'cancelled',
      current_agent = NULL,
      execution_status = NULL,
      overlay_workflow_id = NULL,
      finished_at = NOW()
    WHERE id = $1`,
    [runId],
  );

  await publishRunEvent(runId, {
    status: "cancelled",
    currentAgent: null,
  });
}

const ARTIFACT_JSON_FILES: Record<string, string> = {
  registry: "component-registry.json",
  injections: "testid-injections.json",
  locators: "locator-catalog.json",
  journeys: "journeys.json",
  "execution-report": "execution-report.json",
  "apply-report": "apply-report.json",
};

export function resolveArtifactPath(
  artifactRoot: string,
  key: string,
): string | null {
  if (key.startsWith("pom-")) {
    return path.join(artifactRoot, "poms", key.slice(4));
  }
  if (key.startsWith("spec-")) {
    return path.join(artifactRoot, "tests", key.slice(5));
  }
  const rel = ARTIFACT_JSON_FILES[key];
  if (rel) {
    return path.join(artifactRoot, rel);
  }
  return null;
}

export async function artifactExists(
  artifactRoot: string,
  key: string,
): Promise<boolean> {
  const filePath = resolveArtifactPath(artifactRoot, key);
  if (!filePath) return true;
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ArtifactIndexEntry {
  key: string;
  label: string;
  kind: "json" | "text";
  agent: string;
  artifactType: string;
  summary?: Record<string, unknown>;
  available: boolean;
}

function indexEntryToKey(
  artifactType: string,
  filePath: string,
): { key: string; label: string; kind: "json" | "text" } {
  const base = filePath.split("/").pop() ?? filePath;
  if (artifactType === "registry") {
    return { key: "registry", label: "component-registry.json", kind: "json" };
  }
  if (artifactType === "injections") {
    return { key: "injections", label: "testid-injections.json", kind: "json" };
  }
  if (artifactType === "locators") {
    return { key: "locators", label: "locator-catalog.json", kind: "json" };
  }
  if (artifactType === "journeys") {
    return { key: "journeys", label: "journeys.json", kind: "json" };
  }
  if (artifactType === "execution-report") {
    return { key: "execution-report", label: "execution-report.json", kind: "json" };
  }
  if (artifactType === "apply-report") {
    return { key: "apply-report", label: "apply-report.json", kind: "json" };
  }
  if (artifactType === "pom" || filePath.includes("/poms/")) {
    return { key: `pom-${base}`, label: `poms/${base}`, kind: "text" };
  }
  if (artifactType === "spec" || filePath.includes("/tests/")) {
    return { key: `spec-${base}`, label: `tests/${base}`, kind: "text" };
  }
  return { key: base, label: base, kind: "json" };
}

export async function listArtifactsFromIndex(
  runId: string,
  artifactRoot: string,
): Promise<ArtifactIndexEntry[]> {
  const { rows } = await pool.query(
    `SELECT agent, artifact_type, file_path, summary_json
     FROM artifacts_index WHERE run_id = $1 ORDER BY id DESC`,
    [runId],
  );
  if (rows.length === 0) return [];

  const seen = new Set<string>();
  const items: ArtifactIndexEntry[] = [];
  for (const row of rows) {
    const mapped = indexEntryToKey(String(row.artifact_type), String(row.file_path));
    if (seen.has(mapped.key)) continue;
    seen.add(mapped.key);

    const isTextArtifact =
      mapped.key.startsWith("pom-") || mapped.key.startsWith("spec-");
    const available = isTextArtifact
      ? await artifactExists(artifactRoot, mapped.key)
      : true;
    if (!available) continue;

    items.push({
      ...mapped,
      agent: String(row.agent),
      artifactType: String(row.artifact_type),
      summary: row.summary_json as Record<string, unknown> | undefined,
      available,
    });
  }
  return items;
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
