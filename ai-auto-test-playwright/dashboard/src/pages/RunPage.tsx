import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import { LiveTerminal } from "../components/LiveTerminal.js";
import { useRunWebSocket } from "../hooks/useRunWebSocket.js";
import type { RunRecord } from "../types/project.js";
import { formatCollectOptionLabel } from "../utils/collectLabel.js";
import { buildVncEmbedUrl, waitForVncReady } from "../utils/vncEmbed.js";

type PresetMode = "debug" | "ci" | "custom";

function runSelectionStorageKey(projectId: string): string {
  return `runPage:selectedNodeId:${projectId}`;
}

function loadSavedNodeId(projectId: string | undefined): string {
  if (!projectId) return "";
  try {
    return localStorage.getItem(runSelectionStorageKey(projectId)) ?? "";
  } catch {
    return "";
  }
}

function saveSelectedNodeId(projectId: string | undefined, nodeId: string): void {
  if (!projectId) return;
  try {
    const key = runSelectionStorageKey(projectId);
    if (nodeId) localStorage.setItem(key, nodeId);
    else localStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
}

interface RunStartResponse {
  runId: string;
  jobId: string;
  status: string;
  vncUrl?: string | null;
  vncToken?: string;
}

interface PipelineRunRecord {
  id: string;
  status: string;
  currentStage: string;
  temporalWorkflowId: string;
  runId?: string | null;
  fixIteration?: number;
  error?: string | null;
  temporalProgress?: {
    stage: string;
    status: string;
    runId?: string | null;
  } | null;
}

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const {
    logs,
    running,
    result,
    resetLive,
    vncUrl,
    vncToken,
    pulseAt,
    runStartedAt,
    runId: liveRunId,
    adoptActiveRun,
    syncFinishedRun,
  } = useRunWebSocket();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [preset, setPreset] = useState<PresetMode>("debug");
  const [headed, setHeaded] = useState(true);
  const [slowmo, setSlowmo] = useState(600);
  const [vncPreview, setVncPreview] = useState(false);
  interface CollectItem {
    nodeId: string;
    name: string;
    tc: string | null;
  }
  const [collectItems, setCollectItems] = useState<CollectItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => loadSavedNodeId(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vncSrc, setVncSrc] = useState<string | null>(null);
  const [vncLoadError, setVncLoadError] = useState<string | null>(null);
  const [vncFullscreen, setVncFullscreen] = useState(false);
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRunRecord[]>([]);
  const [pipelineBusy, setPipelineBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    if (!id) return;
    const data = await fetchJson<{ runs: RunRecord[] }>(`/api/projects/${id}/runs`);
    setRuns(data.runs);
  }, [id]);

  const loadPipelineRuns = useCallback(async () => {
    if (!id) return;
    const data = await fetchJson<{ runs: PipelineRunRecord[] }>(`/api/projects/${id}/pipeline/runs`);
    setPipelineRuns(data.runs ?? []);
  }, [id]);

  const openVncPreview = useCallback(async (url: string | null | undefined, token?: string | null) => {
    setVncLoadError(null);
    if (!url) {
      setVncSrc(null);
      return;
    }
    const pageUrl = buildVncEmbedUrl(url, token ?? undefined);
    const ready = await waitForVncReady(pageUrl);
    if (ready) {
      setVncSrc(pageUrl);
    } else {
      setVncSrc(null);
      setVncLoadError("浏览器预览暂不可用，请查看下方终端输出");
    }
  }, []);

  useEffect(() => {
    void loadRuns().catch(() => undefined);
    void loadPipelineRuns().catch(() => undefined);
    const t = window.setInterval(() => {
      void loadRuns();
      void loadPipelineRuns();
    }, 5000);
    return () => window.clearInterval(t);
  }, [loadRuns, loadPipelineRuns]);

  const activeDbRun = runs.find((r) => r.status === "running");
  const liveRunning = running || !!activeDbRun;

  useEffect(() => {
    if (!activeDbRun || running) return;
    adoptActiveRun(activeDbRun.id, activeDbRun.startedAt ?? undefined);
  }, [activeDbRun, running, adoptActiveRun]);

  useEffect(() => {
    if (!liveRunId || !running) return;
    const dbRun = runs.find((r) => r.id === liveRunId);
    if (dbRun) syncFinishedRun(dbRun);
  }, [runs, liveRunId, running, syncFinishedRun]);

  useEffect(() => {
    if (!id) return;
    setSelectedNodeId(loadSavedNodeId(id));
    setCollectItems([]);
    void fetchJson<{ items: CollectItem[]; total: number }>(`/api/projects/${id}/tests/collect`)
      .then((data) => setCollectItems(data.items ?? []))
      .catch(() => setCollectItems([]));
  }, [id]);

  useEffect(() => {
    if (!id || collectItems.length === 0 || !selectedNodeId) return;
    if (!collectItems.some((item) => item.nodeId === selectedNodeId)) {
      setSelectedNodeId("");
      saveSelectedNodeId(id, "");
    }
  }, [id, collectItems, selectedNodeId]);

  useEffect(() => {
    if (liveRunning && vncUrl) {
      void openVncPreview(vncUrl, vncToken);
    }
  }, [liveRunning, vncUrl, vncToken, openVncPreview]);

  useEffect(() => {
    if (result) {
      setVncSrc(null);
      setVncLoadError(null);
      setVncFullscreen(false);
    }
  }, [result]);

  useEffect(() => {
    if (!vncFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVncFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vncFullscreen]);

  const startRun = async (body: Record<string, unknown>) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setVncSrc(null);
    setVncLoadError(null);
    resetLive();
    try {
      const data = await fetchJson<RunStartResponse>(`/api/projects/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await openVncPreview(data.vncUrl, data.vncToken);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
    } finally {
      setBusy(false);
    }
  };

  const runSelection = () => {
    if (!selectedNodeId) return {};
    return { nodeIds: [selectedNodeId] };
  };

  const startPipeline = async (fullPipeline: boolean) => {
    if (!id) return;
    setPipelineBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/projects/${id}/pipeline/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runPreset: preset === "debug" ? "debug" : "ci",
          nodeIds: selectedNodeId ? [selectedNodeId] : undefined,
          skipPlan: !fullPipeline,
          skipCodegen: !fullPipeline,
          autoFix: true,
        }),
      });
      await loadPipelineRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline 启动失败");
    } finally {
      setPipelineBusy(false);
    }
  };

  const runWithPreset = () => {
    if (preset === "custom") {
      void startRun({
        preset: "custom",
        headed,
        slowmo: slowmo || undefined,
        vncPreview: headed && vncPreview,
        ...runSelection(),
      });
      return;
    }
    void startRun({ preset, ...runSelection() });
  };

  const lastFailed = runs.find((r) => r.failed > 0 || r.status === "failed");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">执行测试</h1>
        <p className="text-slate-400 text-sm mt-1">Run preset、单条 pytest 用例或仅重跑失败</p>
      </div>

      <div className="rounded-lg border border-slate-700 p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["debug", "ci", "custom"] as PresetMode[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`px-3 py-1 rounded text-sm ${preset === p ? "bg-emerald-600" : "bg-slate-700"}`}
            >
              {p}
            </button>
          ))}
        </div>

        {preset === "debug" && (
          <p className="text-xs text-slate-400">
            debug 默认 Headed + SlowMo，并在下方展示 Worker 虚拟桌面 noVNC 预览（非本机弹窗）。
          </p>
        )}

        {preset === "custom" && (
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} />
              Headed
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={vncPreview}
                disabled={!headed}
                onChange={(e) => setVncPreview(e.target.checked)}
              />
              浏览器预览
            </label>
            <label className="flex items-center gap-2">
              SlowMo
              <input
                type="number"
                min={0}
                value={slowmo}
                onChange={(e) => setSlowmo(Number(e.target.value))}
                className="w-20 rounded bg-slate-800 border border-slate-600 px-2 py-1"
              />
            </label>
          </div>
        )}

        {collectItems.length > 0 && (
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2">
              可执行用例 ({collectItems.length})
              <select
                value={selectedNodeId}
                onChange={(e) => {
                  const nodeId = e.target.value;
                  setSelectedNodeId(nodeId);
                  saveSelectedNodeId(id, nodeId);
                }}
                className="rounded bg-slate-800 border border-slate-600 px-2 py-1 max-w-xl"
              >
                <option value="">全部 specs/</option>
                {collectItems.map((item) => (
                  <option key={item.nodeId} value={item.nodeId}>
                    {formatCollectOptionLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-500">计划文档中的 TC 编号仅供对照，以下拉 collect 结果为准。</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runWithPreset()}
            disabled={busy || liveRunning}
            className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
          >
            {busy || liveRunning ? "运行中…" : "开始运行"}
          </button>
          {lastFailed && (
            <button
              type="button"
              onClick={() =>
                void startRun({
                  preset: "ci",
                  rerunFailedOnly: true,
                  previousRunId: lastFailed.id,
                })
              }
              disabled={busy || liveRunning}
              className="px-4 py-2 rounded bg-amber-600 text-sm disabled:opacity-50"
            >
              仅重跑失败
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Temporal 全流程 Pipeline</h2>
            <p className="text-xs text-slate-400 mt-1">
              经 Temporal 编排 Run / Fix 重试；完整流程含 Plan → Codegen。Temporal UI：
              <a
                href="http://172.26.9.212:8088"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 ml-1"
              >
                :8088
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void startPipeline(false)}
              disabled={pipelineBusy}
              className="px-4 py-2 rounded bg-indigo-600 text-sm disabled:opacity-50"
            >
              {pipelineBusy ? "提交中…" : "Pipeline 运行（仅 Run+Fix）"}
            </button>
            <button
              type="button"
              onClick={() => void startPipeline(true)}
              disabled={pipelineBusy}
              className="px-4 py-2 rounded bg-indigo-800 text-sm disabled:opacity-50"
            >
              完整 Pipeline
            </button>
          </div>
        </div>
        {pipelineRuns.length > 0 && (
          <ul className="space-y-2 text-sm">
            {pipelineRuns.slice(0, 5).map((p) => (
              <li key={p.id} className="rounded border border-slate-800 px-3 py-2 flex justify-between gap-2">
                <div>
                  <span className="font-mono text-xs text-slate-500">{p.id.slice(0, 8)}</span>
                  <span className="ml-2">{p.status}</span>
                  <span className="ml-2 text-slate-400">{p.currentStage}</span>
                  {p.fixIteration ? (
                    <span className="ml-2 text-slate-500">fix#{p.fixIteration}</span>
                  ) : null}
                  {p.error && <span className="ml-2 text-red-400 truncate">{p.error}</span>}
                </div>
                <span
                  className="text-xs text-slate-500 font-mono truncate max-w-[12rem]"
                  title={p.temporalWorkflowId}
                >
                  {p.temporalWorkflowId}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {vncLoadError && <p className="text-amber-400 text-sm">{vncLoadError}</p>}
      {result && (
        <p className="text-sm text-slate-300">
          完成：{result.passed}P / {result.failed}F / {result.skipped}S ({result.durationMs}ms)
        </p>
      )}

      {vncSrc && (
        <div
          className={
            vncFullscreen
              ? "fixed inset-0 z-50 flex flex-col bg-slate-950"
              : "rounded-lg border border-slate-700 overflow-hidden"
          }
        >
          <div
            className={
              vncFullscreen
                ? "flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-700"
                : "px-3 py-2 border-b border-slate-700 space-y-2"
            }
          >
            <p className="text-xs text-slate-400">
              浏览器窗口与 Worker 虚拟桌面同为 1280×900 贴边显示；预览区按同比例缩放，减少底部黑边。购物车金额条在页面最下方。
            </p>
            <button
              type="button"
              onClick={() => setVncFullscreen((v) => !v)}
              className="shrink-0 px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              {vncFullscreen ? "退出全屏 (Esc)" : "全屏"}
            </button>
          </div>
          <div
            className={
              vncFullscreen
                ? "flex-1 min-h-0 w-full flex items-center justify-center bg-black"
                : "w-full flex items-center justify-center bg-black"
            }
          >
            <iframe
              title="Run browser preview"
              src={vncSrc}
              className={
                vncFullscreen
                  ? "w-full max-h-full aspect-[1280/900] border-0"
                  : "w-full max-h-[calc(100vh-15rem)] aspect-[1280/900] border-0"
              }
            />
          </div>
        </div>
      )}

      <LiveTerminal logs={logs} running={liveRunning} pulseAt={pulseAt} runStartedAt={runStartedAt} />

      <div>
        <h2 className="font-medium mb-3">运行历史</h2>
        <ul className="space-y-2">
          {runs.map((r) => (
            <li key={r.id} className="rounded border border-slate-700 px-4 py-3 flex justify-between gap-2 text-sm">
              <div>
                <span className="font-mono text-xs text-slate-500">{r.id.slice(0, 8)}</span>
                <span className="ml-2">{r.status}</span>
                {r.preset && <span className="ml-2 text-slate-500">({r.preset})</span>}
                <span className="ml-2 text-slate-400">
                  {r.passed}P / {r.failed}F
                </span>
              </div>
              <div className="flex gap-2">
                <Link to={`/projects/${id}/report/${r.id}`} className="text-emerald-400 text-xs">
                  报告
                </Link>
                {(r.failed > 0 || r.status === "failed") && (
                  <Link to={`/projects/${id}/fix/${r.id}`} className="text-amber-400 text-xs">
                    修复审查
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
