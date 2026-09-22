import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import { LiveTerminal } from "../components/LiveTerminal.js";
import { useRunWebSocket } from "../hooks/useRunWebSocket.js";
import type { RunRecord } from "../types/project.js";
import { buildVncEmbedUrl, waitForVncReady } from "../utils/vncEmbed.js";

type PresetMode = "debug" | "ci" | "custom";

interface RunStartResponse {
  runId: string;
  jobId: string;
  status: string;
  vncUrl?: string | null;
  vncToken?: string;
}

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const { logs, running, result, resetLive, vncUrl, vncToken } = useRunWebSocket();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [preset, setPreset] = useState<PresetMode>("debug");
  const [headed, setHeaded] = useState(true);
  const [slowmo, setSlowmo] = useState(600);
  const [vncPreview, setVncPreview] = useState(false);
  const [tcList, setTcList] = useState<string[]>([]);
  const [selectedTc, setSelectedTc] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vncSrc, setVncSrc] = useState<string | null>(null);
  const [vncLoadError, setVncLoadError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!id) return;
    const data = await fetchJson<{ runs: RunRecord[] }>(`/api/projects/${id}/runs`);
    setRuns(data.runs);
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
    const t = window.setInterval(() => void loadRuns(), 5000);
    return () => window.clearInterval(t);
  }, [loadRuns]);

  useEffect(() => {
    if (!id) return;
    void fetchJson<{ content: string }>(`/api/projects/${id}/plan`)
      .then((plan) => {
        const ids = [...plan.content.matchAll(/TC-(\d+)/gi)].map((m) => `TC-${m[1]!.padStart(3, "0")}`);
        setTcList([...new Set(ids)].sort());
      })
      .catch(() => setTcList([]));
  }, [id]);

  useEffect(() => {
    if (running && vncUrl) {
      void openVncPreview(vncUrl, vncToken);
    }
  }, [running, vncUrl, vncToken, openVncPreview]);

  useEffect(() => {
    if (result) {
      setVncSrc(null);
      setVncLoadError(null);
    }
  }, [result]);

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

  const runWithPreset = () => {
    if (preset === "custom") {
      void startRun({
        preset: "custom",
        headed,
        slowmo: slowmo || undefined,
        vncPreview: headed && vncPreview,
        specFilter: selectedTc || null,
      });
      return;
    }
    void startRun({ preset, specFilter: selectedTc || null });
  };

  const lastFailed = runs.find((r) => r.failed > 0 || r.status === "failed");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">执行测试</h1>
        <p className="text-slate-400 text-sm mt-1">Run preset、单 TC 或仅重跑失败</p>
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

        {tcList.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            单 TC
            <select
              value={selectedTc}
              onChange={(e) => setSelectedTc(e.target.value)}
              className="rounded bg-slate-800 border border-slate-600 px-2 py-1"
            >
              <option value="">全部</option>
              {tcList.map((tc) => (
                <option key={tc} value={`specs/`}>
                  {tc}（需 nodeId 映射）
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runWithPreset()}
            disabled={busy || running}
            className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
          >
            {busy || running ? "运行中…" : "开始运行"}
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
              disabled={busy || running}
              className="px-4 py-2 rounded bg-amber-600 text-sm disabled:opacity-50"
            >
              仅重跑失败
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {vncLoadError && <p className="text-amber-400 text-sm">{vncLoadError}</p>}
      {result && (
        <p className="text-sm text-slate-300">
          完成：{result.passed}P / {result.failed}F / {result.skipped}S ({result.durationMs}ms)
        </p>
      )}

      {vncSrc && (
        <div className="rounded-lg border border-slate-700 overflow-hidden">
          <p className="text-xs text-slate-400 px-3 py-2 border-b border-slate-700">
            浏览器在 Worker 虚拟桌面中执行；此处为 noVNC 实时预览（只读观看）。
          </p>
          <iframe title="Run browser preview" src={vncSrc} className="w-full h-[min(480px,calc(100vh-18rem))] bg-black" />
        </div>
      )}

      <LiveTerminal logs={logs} running={running} />

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
