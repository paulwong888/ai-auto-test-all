import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArtifactPreview,
  previewMetaForArtifact,
} from "./components/ArtifactPreview";
import { ProjectPanel, type ProjectRecord } from "./components/ProjectPanel";
import { RunHistoryPanel } from "./components/RunHistoryPanel";
import { usePipelineWebSocket } from "./hooks/usePipelineWebSocket";
import { mergePipelineProgress } from "./lib/merge-progress";

const AGENTS = [
  { id: "scriptAnalyst", label: "Script Analyst" },
  { id: "stageManager", label: "Stage Manager" },
  { id: "blockingCoach", label: "Blocking Coach" },
  { id: "setDesigner", label: "Set Designer" },
  { id: "choreographer", label: "Choreographer" },
  { id: "assistantDirector", label: "Assistant Director" },
  { id: "continuityLead", label: "Continuity Lead" },
];

const BASE_ARTIFACT_LINKS = [
  { key: "registry", label: "component-registry.json", agent: "scriptAnalyst" },
  { key: "injections", label: "testid-injections.json", agent: "stageManager" },
  { key: "locators", label: "locator-catalog.json", agent: "blockingCoach" },
  { key: "journeys", label: "journeys.json", agent: "choreographer" },
  { key: "execution-report", label: "execution-report.json", agent: "continuityLead" },
] as const;

const CORE_ARTIFACT_ORDER = [
  "registry",
  "injections",
  "locators",
  "apply-report",
  "journeys",
  "execution-report",
] as const;

const CORE_KEYS = new Set<string>(CORE_ARTIFACT_ORDER);

function resolveArtifactAgent(key: string): string {
  const base = BASE_ARTIFACT_LINKS.find((b) => b.key === key);
  if (base) return base.agent;
  if (key.startsWith("pom-")) return "setDesigner";
  if (key.startsWith("spec-")) return "assistantDirector";
  return "scriptAnalyst";
}

interface ArtifactLink {
  key: string;
  label: string;
  agent: string;
  available?: boolean;
}

interface Progress {
  status: string;
  currentAgent: string | null;
  completedAgents: string[];
  artifactRoot?: string;
  error?: string;
  executeAfterGenerate?: boolean;
  skippedAgents?: string[];
}

interface RunRecord {
  status: string;
  execution_status?: string | null;
}

function coreArtifactRank(key: string): number {
  const idx = CORE_ARTIFACT_ORDER.indexOf(
    key as (typeof CORE_ARTIFACT_ORDER)[number],
  );
  return idx === -1 ? CORE_ARTIFACT_ORDER.length : idx;
}

function groupArtifactLinks(links: ArtifactLink[]) {
  const core = links
    .filter((a) => CORE_KEYS.has(a.key))
    .sort((a, b) => coreArtifactRank(a.key) - coreArtifactRank(b.key));
  const poms = links
    .filter((a) => a.key.startsWith("pom-"))
    .sort((a, b) => a.label.localeCompare(b.label));
  const specs = links
    .filter((a) => a.key.startsWith("spec-"))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { core, poms, specs };
}

function CollapsibleLinkGroup({
  title,
  items,
  renderLink,
}: {
  title: string;
  items: ArtifactLink[];
  renderLink: (a: ArtifactLink) => ReactNode;
}) {
  if (items.length === 0) return null;

  return (
    <details className="link-group-details" open={items.length <= 5}>
      <summary className="link-group-title">
        {title} ({items.length})
      </summary>
      <div className="link-group-items">{items.map(renderLink)}</div>
    </details>
  );
}

function readRunIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("runId");
}

function readProjectIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("projectId");
}

function setRunIdInUrl(runId: string | null): void {
  const url = new URL(window.location.href);
  if (runId) {
    url.searchParams.set("runId", runId);
  } else {
    url.searchParams.delete("runId");
  }
  window.history.replaceState({}, "", url.toString());
}

function setProjectIdInUrl(projectId: string | null): void {
  const url = new URL(window.location.href);
  if (projectId) {
    url.searchParams.set("projectId", projectId);
  } else {
    url.searchParams.delete("projectId");
  }
  window.history.replaceState({}, "", url.toString());
}

export default function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState(() => readProjectIdFromUrl() ?? "");
  const [runId, setRunId] = useState<string | null>(readRunIdFromUrl());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [previewMeta, setPreviewMeta] = useState<string>("");
  const [activeArtifactKey, setActiveArtifactKey] = useState<string | null>(null);
  const [artifactLinks, setArtifactLinks] = useState<ArtifactLink[]>([
    ...BASE_ARTIFACT_LINKS,
  ]);
  const [loading, setLoading] = useState(false);
  const [executingOnly, setExecutingOnly] = useState(false);
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyTestIds, setApplyTestIds] = useState(false);
  const [executeAfterGenerate, setExecuteAfterGenerate] = useState(true);
  const [executionMode, setExecutionMode] = useState<"auto" | "platform" | "direct">(
    "auto",
  );
  const [journeySpecOverlay, setJourneySpecOverlay] = useState<{
    key: string;
    content: string;
  } | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const pollRunRef = useRef<(id: string) => Promise<void>>(async () => {});
  const urlHydratedRef = useRef(false);

  const clearRunViewState = useCallback(() => {
    setRunId(null);
    setProgress(null);
    setActiveRun(null);
    setPreview("");
    setPreviewMeta("");
    setActiveArtifactKey(null);
    setPreviewError(null);
    setJourneySpecOverlay(null);
    setArtifactLinks([...BASE_ARTIFACT_LINKS]);
    setLoading(false);
    setExecutingOnly(false);
  }, []);

  const handleProjectSelect = useCallback(
    (id: string) => {
      setProjectId(id);
      setProjectIdInUrl(id);
      setRunIdInUrl(null);
      clearRunViewState();
    },
    [clearRunViewState],
  );

  const loadArtifactList = useCallback(async (id: string) => {
    const listRes = await fetch(`/api/pipeline/runs/${id}/artifacts/list`);
    const listData = await listRes.json();
    if (listData.ok && listData.files?.length) {
      setArtifactLinks(
        listData.files.map(
          (f: {
            key: string;
            label: string;
            agent?: string;
            available?: boolean;
          }) => ({
            key: f.key,
            label: f.label,
            agent: f.agent ?? resolveArtifactAgent(f.key),
            available: f.available !== false,
          }),
        ),
      );
    }
    return listData;
  }, []);

  const loadArtifact = useCallback(async (name: string, currentRunId?: string) => {
    const id = currentRunId ?? runId;
    if (!id) return;
    const res = await fetch(
      `/api/pipeline/runs/${id}/artifacts/${encodeURIComponent(name)}`,
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
      };
      setJourneySpecOverlay(null);
      setActiveArtifactKey(name);
      setPreview("");
      setPreviewMeta("");
      if (err.code === "ARTIFACT_NOT_READY") {
        setPreviewError("文件不存在或尚未生成，请等待对应 Agent 完成");
        return;
      }
      setPreviewError(err.error ?? `加载失败 (${res.status})`);
      return;
    }
    const text = await res.text();
    setPreviewError(null);
    setJourneySpecOverlay(null);
    setActiveArtifactKey(name);
    setPreview(text);
    setPreviewMeta(previewMetaForArtifact(name, text));
    requestAnimationFrame(() => {
      previewScrollRef.current?.scrollTo(0, 0);
    });
  }, [runId]);

  const handleAgentCompleted = useCallback(
    (agent: string) => {
      if (!runId) return;
      void loadArtifactList(runId);
      if (agent === "choreographer") {
        void loadArtifact("journeys", runId);
      }
      if (agent === "continuityLead") {
        void loadArtifact("execution-report", runId);
      }
    },
    [runId, loadArtifact, loadArtifactList],
  );

  const handleExecutionFinished = useCallback(
    (status: "completed" | "failed") => {
      setActiveRun((prev) =>
        prev ? { ...prev, execution_status: status } : prev,
      );
      setLoading(false);
      setExecutingOnly(false);
    },
    [],
  );

  const { connected: wsConnected, progress: wsProgress } = usePipelineWebSocket(
    runId,
    loading,
    handleAgentCompleted,
    {
      executeAfterGenerate: executingOnly ? true : executeAfterGenerate,
      executeOnly: executingOnly,
      onConnected: runId ? () => void pollRunRef.current(runId) : undefined,
      onExecutionFinished: handleExecutionFinished,
    },
  );

  useEffect(() => {
    if (!wsProgress) return;
    setProgress((prev) => mergePipelineProgress(prev, wsProgress));
    if (wsProgress.status === "completed" || wsProgress.status === "failed") {
      setLoading(false);
      setExecutingOnly(false);
    }
  }, [wsProgress]);

  const availableSpecKeys = useMemo(
    () =>
      new Set(
        artifactLinks.filter((a) => a.key.startsWith("spec-")).map((a) => a.key),
      ),
    [artifactLinks],
  );

  const linkGroups = useMemo(
    () => groupArtifactLinks(artifactLinks),
    [artifactLinks],
  );

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    const list = (data.projects ?? []) as ProjectRecord[];
    setProjects(list);
    setProjectId((prev) => {
      const fromUrl = readProjectIdFromUrl();
      if (fromUrl && list.some((p) => p.id === fromUrl)) return fromUrl;
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    void loadProjects().catch((e) => setError(String(e)));
  }, [loadProjects]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const canRunPipeline = selectedProject?.cloneStatus === "ready";

  const loadJourneySpecOverlay = useCallback(
    async (specKey: string) => {
      const id = runId;
      if (!id) return;
      const res = await fetch(
        `/api/pipeline/runs/${id}/artifacts/${encodeURIComponent(specKey)}`,
      );
      const text = await res.text();
      setJourneySpecOverlay({ key: specKey, content: text });
      requestAnimationFrame(() => {
        previewScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    },
    [runId],
  );

  const pollRun = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/pipeline/runs/${id}`);
      const data = await res.json();
      if (data.run) {
        setActiveRun({
          status: String(data.run.status),
          execution_status: data.run.execution_status as string | null | undefined,
        });
      }
      if (data.progress) {
        setProgress(data.progress);
        if (
          data.run?.execution_status === "completed" ||
          data.run?.execution_status === "failed"
        ) {
          setExecutingOnly(false);
        }
      }
      const execRunning = data.run?.execution_status === "running";
      if (execRunning) {
        setLoading(true);
        return;
      }
      if (
        data.progress?.status === "completed" ||
        data.progress?.status === "failed" ||
        data.progress?.status === "cancelled"
      ) {
        setLoading(false);
        setExecutingOnly(false);
        const listData = await loadArtifactList(id);
        const hasReport = listData?.files?.some(
          (f: { key: string }) => f.key === "execution-report",
        );
        if (data.progress?.status === "completed") {
          void loadArtifact(hasReport ? "execution-report" : "journeys", id);
        } else if (
          data.progress?.status === "failed" &&
          (hasReport || data.run?.execution_status === "failed")
        ) {
          if (hasReport) void loadArtifact("execution-report", id);
        }
      }
    },
    [loadArtifact, loadArtifactList],
  );

  pollRunRef.current = pollRun;

  useEffect(() => {
    if (!runId || !loading) return;
    const t = setInterval(() => void pollRun(runId), 2500);
    return () => clearInterval(t);
  }, [runId, loading, pollRun]);

  const loadHistoricalRun = useCallback(
    async (id: string) => {
      setRunId(id);
      setRunIdInUrl(id);
      setError(null);
      setJourneySpecOverlay(null);
      try {
        const res = await fetch(`/api/pipeline/runs/${id}`);
        const data = await res.json();
        const execStatus = data.run?.execution_status as
          | string
          | null
          | undefined;
        if (data.run) {
          setActiveRun({
            status: String(data.run.status),
            execution_status: execStatus,
          });
          if (data.run.project_id) {
            const pid = String(data.run.project_id);
            setProjectId(pid);
            setProjectIdInUrl(pid);
          }
          // Sync start-option controls from the values stored in DB so
          // retries/resumes use what the run was started with ("选啥就是啥").
          if (
            data.run.execution_mode === "auto" ||
            data.run.execution_mode === "platform" ||
            data.run.execution_mode === "direct"
          ) {
            setExecutionMode(data.run.execution_mode);
          }
          if (typeof data.run.execute_after_generate === "boolean") {
            setExecuteAfterGenerate(data.run.execute_after_generate);
          }
          if (typeof data.run.apply_test_ids === "boolean") {
            setApplyTestIds(data.run.apply_test_ids);
          }
        }
        if (data.progress) setProgress(data.progress);
        const listData = await loadArtifactList(id);
        const listHasReport = listData?.files?.some(
          (f: { key: string }) => f.key === "execution-report",
        );
        const status = data.progress?.status ?? data.run?.status;
        const completedAgents: string[] =
          data.progress?.completedAgents ?? [];
        if (
          status === "completed" ||
          completedAgents.includes("choreographer")
        ) {
          await loadArtifact("journeys", id);
        }
        if (
          execStatus === "completed" ||
          execStatus === "failed" ||
          (listHasReport && execStatus !== "running")
        ) {
          await loadArtifact("execution-report", id);
        }
        const runActive =
          execStatus === "running" ||
          data.run?.status === "running" ||
          data.progress?.status === "running";
        if (execStatus === "running") {
          setExecutingOnly(true);
          setLoading(true);
          void pollRun(id);
        } else if (runActive) {
          // Generation phase has execution_status == null but the run is
          // still active — keep loading so WS + polling stay enabled.
          setExecutingOnly(false);
          setLoading(true);
          void pollRun(id);
        } else {
          setExecutingOnly(false);
          setLoading(false);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        setExecutingOnly(false);
      }
    },
    [loadArtifact, loadArtifactList, pollRun],
  );

  useEffect(() => {
    if (urlHydratedRef.current) return;
    urlHydratedRef.current = true;
    const urlProjectId = readProjectIdFromUrl();
    if (urlProjectId) setProjectId(urlProjectId);
    const urlRunId = readRunIdFromUrl();
    if (urlRunId) void loadHistoricalRun(urlRunId);
  }, [loadHistoricalRun]);

  useEffect(() => {
    const onPopState = () => {
      const urlProjectId = readProjectIdFromUrl();
      setProjectId(urlProjectId ?? "");
      const urlRunId = readRunIdFromUrl();
      if (urlRunId) {
        void loadHistoricalRun(urlRunId);
      } else {
        clearRunViewState();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [clearRunViewState, loadHistoricalRun]);

  async function runExecuteJourneys(journeyIds: string[]) {
    if (!runId) return;
    setLoading(true);
    setExecutingOnly(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/runs/${runId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionMode,
          ...(journeyIds.length > 0 ? { journeyIds } : {}),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "execute failed",
        );
      }
      setActiveRun((prev) => ({
        status: prev?.status ?? "completed",
        execution_status: "running",
      }));
      void pollRun(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
      setExecutingOnly(false);
    }
  }

  async function runExecuteOnly() {
    await runExecuteJourneys([]);
  }

  async function runResumeFromAgent(fromAgent: string) {
    if (!runId) return;
    const downstreamAgents = [
      "setDesigner",
      "choreographer",
      "assistantDirector",
      "continuityLead",
    ];
    if (downstreamAgents.includes(fromAgent)) {
      const ok = window.confirm(
        `从 ${fromAgent} 起重跑将删除下游 artifact（journeys/specs 等）。是否继续？`,
      );
      if (!ok) return;
    }

    setLoading(true);
    setExecutingOnly(fromAgent === "continuityLead");
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/runs/${runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAgent,
          executeAfterGenerate:
            fromAgent === "continuityLead" ? true : executeAfterGenerate,
          executionMode,
          applyTestIds,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "resume failed",
        );
      }
      setActiveRun((prev) => ({
        status: "running",
        execution_status:
          fromAgent === "continuityLead" ? "running" : prev?.execution_status,
      }));
      void pollRun(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
      setExecutingOnly(false);
    }
  }

  async function startPipeline() {
    if (!projectId || !canRunPipeline) return;
    setLoading(true);
    setExecutingOnly(false);
    setError(null);
    setPreview("");
    setPreviewMeta("");
    setActiveArtifactKey(null);
    setJourneySpecOverlay(null);
    setArtifactLinks([...BASE_ARTIFACT_LINKS]);
    setProgress(null);
    try {
      const res = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          applyTestIds,
          executeAfterGenerate,
          executionMode,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "start failed",
        );
      }
      setRunId(data.runId);
      setProjectIdInUrl(projectId);
      setRunIdInUrl(data.runId);
      void pollRun(data.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  async function cancelPipeline() {
    if (!runId) return;
    try {
      const res = await fetch(`/api/pipeline/runs/${runId}/cancel`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error ?? "cancel failed");
      }
      setLoading(false);
      setProgress((prev) =>
        prev ? { ...prev, status: "cancelled", currentAgent: null } : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const hasJourneysArtifact = artifactLinks.some((a) => a.key === "journeys");
  const hasExecutionReport = artifactLinks.some(
    (a) => a.key === "execution-report",
  );
  const hasSpecArtifacts = artifactLinks.some((a) => a.key.startsWith("spec-"));
  const executionStatus = activeRun?.execution_status;
  const showPreviewBack =
    hasJourneysArtifact &&
    activeArtifactKey !== "journeys" &&
    activeArtifactKey !== null &&
    activeArtifactKey !== "execution-report";

  function stepStatus(
    agentId: string,
  ): "done" | "active" | "pending" | "skipped" | "failed" {
    if (agentId === "continuityLead") {
      const execStatus = activeRun?.execution_status;
      if (execStatus === "running") return "active";
      if (execStatus === "failed") return "failed";
      if (execStatus === "completed") return "done";
    }

    if (progress?.completedAgents?.includes(agentId)) return "done";
    if (progress?.currentAgent === agentId) return "active";

    // On a cancelled/failed run, mark the first incomplete agent as failed
    // so the interruption point is visible (and resumable).
    if (
      runFinished &&
      activeRun?.status !== "running" &&
      progress?.status !== "running" &&
      agentId !== "continuityLead"
    ) {
      const firstIncomplete = AGENTS.map((a) => a.id).find(
        (id) =>
          id !== "continuityLead" && !progress?.completedAgents?.includes(id),
      );
      if (agentId === firstIncomplete) return "failed";
    }

    if (agentId === "continuityLead") {
      if (hasExecutionReport) return "done";
      const execStatus = activeRun?.execution_status;
      if (
        execStatus == null &&
        progress?.skippedAgents?.includes("continuityLead")
      ) {
        return "skipped";
      }
      if (
        execStatus == null &&
        progress?.status === "completed" &&
        !progress.completedAgents.includes("continuityLead")
      ) {
        return "skipped";
      }
      return "pending";
    }

    if (
      activeRun?.execution_status == null &&
      progress?.skippedAgents?.includes(agentId)
    ) {
      return "skipped";
    }
    return "pending";
  }

  function stepStatusLabel(agentId: string): string {
    const status = stepStatus(agentId);
    if (status === "skipped") return "skipped / 已跳过";
    if (status === "failed") return "failed / 执行失败";
    return status;
  }

  const runFinished =
    activeRun?.status === "completed" ||
    activeRun?.status === "failed" ||
    activeRun?.status === "cancelled" ||
    progress?.status === "completed" ||
    progress?.status === "failed" ||
    progress?.status === "cancelled";
  const showReExecuteButton =
    !!runId &&
    !loading &&
    hasSpecArtifacts &&
    executionStatus !== "running" &&
    runFinished &&
    (executionStatus == null ||
      executionStatus === "completed" ||
      executionStatus === "failed");

  function canRetryFromAgent(agentId: string): boolean {
    if (!runId || loading) return false;
    const status = stepStatus(agentId);
    const resumable =
      status === "done" ||
      status === "failed" ||
      status === "skipped" ||
      // Cancelled/failed runs may be continued from steps that never ran
      // (they show as "pending" but are valid resume entry points).
      (runFinished && status === "pending");
    if (!resumable) return false;
    if (agentId === "continuityLead") {
      return hasSpecArtifacts && executionStatus !== "running";
    }
    return runFinished && activeRun?.status !== "running";
  }
  const showExecutionSkippedHint =
    executionStatus == null && stepStatus("continuityLead") === "skipped";
  const showChoreographerFailedHint =
    progress?.status === "failed" &&
    typeof progress.error === "string" &&
    progress.error.includes("Choreographer");
  const showExecutionReportMissingHint =
    executionStatus === "failed" && !hasExecutionReport;
  const showExecutionFailedHint =
    !showExecutionReportMissingHint &&
    (executionStatus === "failed" ||
      (progress?.status === "failed" && !showChoreographerFailedHint));

  function isArtifactReady(agentId: string): boolean {
    if (agentId === "continuityLead" && hasExecutionReport) return true;
    return stepStatus(agentId) === "done";
  }

  function renderLink(a: ArtifactLink) {
    const ready = isArtifactReady(a.agent) && a.available !== false;
    const generating = stepStatus(a.agent) === "active";
    const active = activeArtifactKey === a.key;
    return (
      <a
        key={a.key}
        href="#"
        className={[!ready ? "disabled" : "", active ? "active" : ""]
          .filter(Boolean)
          .join(" ")}
        onClick={(e) => {
          e.preventDefault();
          if (!ready) return;
          void loadArtifact(a.key);
        }}
      >
        {a.label}
        {generating ? " (生成中…)" : ""}
      </a>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>Monday Director — Artifact 工作台</h1>
        <p>
          Temporal 编排 · Agent 1–7 生成 + 执行（Gherkin / Playwright）
          {wsConnected && loading && (
            <span className="badge badge-ready"> WS 已连接</span>
          )}
        </p>
      </header>

      <ProjectPanel
        projects={projects}
        selectedId={projectId}
        onRefresh={loadProjects}
        onSelect={handleProjectSelect}
      />

      <div className="toolbar">
        <select
          value={projectId}
          onChange={(e) => handleProjectSelect(e.target.value)}
          disabled={loading}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.cloneStatus})
            </option>
          ))}
        </select>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={applyTestIds}
            onChange={(e) => setApplyTestIds(e.target.checked)}
            disabled={loading}
          />
          注入 testid
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={executeAfterGenerate}
            onChange={(e) => setExecuteAfterGenerate(e.target.checked)}
            disabled={loading}
          />
          生成后执行
        </label>
        <select
          value={executionMode}
          onChange={(e) =>
            setExecutionMode(e.target.value as "auto" | "platform" | "direct")
          }
          disabled={loading || !executeAfterGenerate}
          title="执行模式"
        >
          <option value="auto">执行: auto</option>
          <option value="platform">执行: platform</option>
          <option value="direct">执行: direct</option>
        </select>
        <button
          onClick={() => void startPipeline()}
          disabled={loading || !projectId || !canRunPipeline}
          title={
            canRunPipeline ? undefined : "请先 Clone 项目（状态 ready）"
          }
        >
          {loading ? "流水线运行中…" : "启动 Director 流水线"}
        </button>
        {loading && runId && (
          <button type="button" className="btn-secondary" onClick={() => void cancelPipeline()}>
            取消
          </button>
        )}
        {showReExecuteButton && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void runExecuteOnly()}
          >
            补跑执行
          </button>
        )}
        {runId && <span>runId: {runId.slice(0, 8)}…</span>}
      </div>

      {!canRunPipeline && selectedProject && (
        <p className="hint warn">
          {selectedProject.localPathOverride &&
          !selectedProject.frontendGitUrl &&
          !selectedProject.backendGitUrl
            ? "Mount 项目挂载路径尚不可用，请检查路径或刷新项目列表"
            : "请先 Clone 项目后再启动 pipeline"}
        </p>
      )}

      {error && <div className="error">{error}</div>}

      <div className="layout layout-three">
        <RunHistoryPanel
          projectId={projectId}
          activeRunId={runId}
          onSelect={(id) => void loadHistoricalRun(id)}
        />

        <section className="panel">
          <h2>Pipeline 进度</h2>
          <ul className="steps">
            {AGENTS.map((a) => (
              <li key={a.id} className={stepStatus(a.id)}>
                <span>{a.label}</span>
                <span className="step-status-row">
                  <span>{stepStatusLabel(a.id)}</span>
                  {canRetryFromAgent(a.id) && (
                    <button
                      type="button"
                      className="step-retry"
                      onClick={() => {
                        if (a.id === "continuityLead") {
                          void runExecuteOnly();
                        } else {
                          void runResumeFromAgent(a.id);
                        }
                      }}
                    >
                      从此重跑
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {progress?.status && (
            <p>
              状态: <strong>{progress.status}</strong>
            </p>
          )}
          {showExecutionSkippedHint && (
            <p className="hint">
              未开启「生成后执行」，Continuity Lead 已跳过。可点击「补跑执行」运行 Playwright。
            </p>
          )}
          {progress?.currentAgent === "choreographer" && loading && (
            <p className="hint">
              Choreographer 正在生成 journeys（LLM 可能需要 1–2 分钟）…
            </p>
          )}
          {progress?.error && (
            <p className="error">{progress.error}</p>
          )}
          {showExecutionReportMissingHint && (
            <p className="hint warn">
              执行报告已缺失（可能因重新生成 artifact 被清理）。请在项目设置中配置
              E2E 登录信息后点击「补跑执行」。
            </p>
          )}
          {executionStatus === "running" && (
            <p className="hint">
              Continuity Lead 正在执行 Playwright 测试…
              {hasExecutionReport
                ? " 当前 execution-report 可能尚未更新。"
                : ""}
            </p>
          )}
          {showExecutionFailedHint && (
            <p className="hint warn">
              Continuity Lead 执行失败
              {progress?.error ? `：${progress.error}` : ""}。请查看
              execution-report 中的 failureType（A=方法缺失，B=定位器，C=权限/登录）；
              也可从 Assistant Director 重新生成后补跑。
            </p>
          )}
          {showChoreographerFailedHint && (
            <p className="hint">
              Choreographer 未能通过 LLM 生成 journeys。请检查 Higress/LLM
              环境变量（如 <code>HIGRESS_BASE_URL</code>、
              <code>HIGRESS_API_KEY</code>、
              <code>CHOREOGRAPHER_LLM_TIMEOUT</code>
              ），修复后重新启动 pipeline。
            </p>
          )}
          {progress?.artifactRoot && (
            <p className="mono muted">{progress.artifactRoot}</p>
          )}
        </section>

        <section className="panel panel-preview">
          <h2>
            Artifact 预览{" "}
            {previewMeta && <span className="hint">({previewMeta})</span>}
          </h2>
          <div className="links">
            {linkGroups.core.length > 0 && (
              <div className="link-group">
                <span className="link-group-title">核心 JSON</span>
                {linkGroups.core.map(renderLink)}
              </div>
            )}
            <CollapsibleLinkGroup
              title="POMs"
              items={linkGroups.poms}
              renderLink={renderLink}
            />
            <CollapsibleLinkGroup
              title="Playwright Specs"
              items={linkGroups.specs}
              renderLink={renderLink}
            />
          </div>
          {showPreviewBack && (
            <div className="preview-nav">
              <button
                type="button"
                className="preview-back"
                onClick={() => void loadArtifact("journeys")}
              >
                ← 返回 journeys
              </button>
              <span className="muted preview-nav-hint">
                或点击上方「journeys.json」
              </span>
            </div>
          )}
          <div className="layout-preview" ref={previewScrollRef}>
            {activeArtifactKey ? (
              previewError ? (
                <div className="preview-error">
                  <p className="error">{previewError}</p>
                  <p className="hint mono muted">{activeArtifactKey}</p>
                </div>
              ) : preview ? (
                <ArtifactPreview
                  artifactKey={activeArtifactKey}
                  content={preview}
                  availableSpecKeys={availableSpecKeys}
                  journeySpecOverlay={journeySpecOverlay}
                  onCloseJourneySpec={() => setJourneySpecOverlay(null)}
                  onViewSpec={(key) => void loadJourneySpecOverlay(key)}
                  onRetryJourneys={(ids) => void runExecuteJourneys(ids)}
                  retryDisabled={loading}
                  executionRunning={executionStatus === "running"}
                />
              ) : (
                <p className="hint preview-empty">加载中…</p>
              )
            ) : (
              <p className="hint preview-empty">点击上方链接加载 artifact…</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
