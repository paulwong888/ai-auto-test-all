import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import { FixAnalysisPanel } from "../components/FixAnalysisPanel.js";
import { useJobPoll } from "../hooks/useJobPoll.js";
import type { FixSuggestion, RunRecord } from "../types/project.js";

export function ReportPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { pollJob } = useJobPoll();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fix, setFix] = useState<FixSuggestion | null>(null);
  const [videos, setVideos] = useState<{ path: string; label: string }[]>([]);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadRun = async () => {
    if (!id || !runId) return;
    const r = await fetchJson<RunRecord>(`/api/projects/${id}/runs/${runId}`);
    setRun(r);
    return r;
  };

  useEffect(() => {
    if (!id || !runId) return;
    setVideos([]);
    setVideosLoaded(false);
    void loadRun()
      .then((r) => {
        if (!r) return;
        if (r.options?.recordVideo === true) {
          void fetchJson<{ videos: { path: string; label: string }[] }>(
            `/api/projects/${id}/runs/${runId}/videos`,
          )
            .then((data) => setVideos(data.videos ?? []))
            .catch(() => setVideos([]))
            .finally(() => setVideosLoaded(true));
        } else {
          setVideosLoaded(true);
        }
      })
      .catch(() => setRun(null));
    void fetchJson<FixSuggestion>(`/api/projects/${id}/runs/${runId}/fix`)
      .then(setFix)
      .catch(() => setFix(null));
  }, [id, runId]);

  useEffect(() => {
    if (!id || !runId || run?.status !== "running") return;
    const t = window.setInterval(() => {
      void loadRun().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(t);
  }, [id, runId, run?.status]);

  const cancelRun = async () => {
    if (!id || !runId) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const updated = await fetchJson<RunRecord>(`/api/projects/${id}/runs/${runId}/cancel`, {
        method: "POST",
      });
      setRun(updated);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "取消失败");
    } finally {
      setCancelBusy(false);
    }
  };

  const analyzeFix = async () => {
    if (!id || !runId) return;
    setFixLoading(true);
    setFixError(null);
    try {
      const { jobId } = await fetchJson<{ jobId: string }>(`/api/projects/${id}/fix/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const job = await pollJob(jobId);
      if (job.status === "failed") throw new Error(job.error ?? "分析失败");
      const data = await fetchJson<FixSuggestion>(`/api/projects/${id}/runs/${runId}/fix`);
      setFix(data);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setFixLoading(false);
    }
  };

  const showFix = run && (run.status === "failed" || run.failed > 0);

  return (
    <div className="space-y-4 -mx-6 -my-4 flex flex-col min-h-[calc(100vh-8rem)]">
      <div className="px-6 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
        <div>
          <Link to={`/projects/${id}/run`} className="text-sm text-emerald-400 hover:underline">
            ← 返回执行
          </Link>
          <h1 className="font-medium mt-1">测试报告</h1>
          {run && (
            <p className="text-xs text-slate-500 font-mono">
              {runId} · {run.status} · {run.passed}P / {run.failed}F
            </p>
          )}
          {cancelError && <p className="text-xs text-red-400 mt-1">{cancelError}</p>}
        </div>
        {run?.status === "running" && (
          <button
            type="button"
            onClick={() => void cancelRun()}
            disabled={cancelBusy}
            className="px-4 py-2 rounded bg-red-700 hover:bg-red-600 text-sm disabled:opacity-50"
          >
            {cancelBusy ? "取消中…" : "取消当前 Run"}
          </button>
        )}
      </div>

      {run?.status === "running" && (
        <p className="px-6 text-sm text-amber-400/90">Run 仍在执行，报告可能不完整；可取消或稍后刷新。</p>
      )}

      <iframe
        key={runId}
        title="pytest report"
        src={`/api/projects/${id}/runs/${runId}/report?v=${encodeURIComponent(runId)}`}
        className="flex-1 w-full min-h-[480px] bg-white"
      />

      {run?.options?.recordVideo === true && videosLoaded && (
        <div className="px-6 py-3 border-t border-slate-800 space-y-3">
          <h2 className="text-sm font-medium">Run 录像</h2>
          {videos.length === 0 ? (
            <p className="text-xs text-amber-400/90">
              已开启录像，但未找到 test-results 下的 video.webm（可能尚未落盘或路径异常）。
            </p>
          ) : (
            <ul className="space-y-4">
              {videos.map((v) => {
                const src = `/api/projects/${id}/runs/${runId}/videos/download?path=${encodeURIComponent(v.path)}`;
                return (
                  <li key={v.path} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="text-slate-400 font-mono">{v.label}</span>
                      <a href={src} download className="text-emerald-400 hover:underline">
                        下载 webm
                      </a>
                    </div>
                    <video controls className="max-w-3xl w-full rounded border border-slate-700 bg-black" src={src}>
                      <track kind="captions" />
                    </video>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {showFix && id && runId && (
        <div className="px-6 pb-2">
          <Link to={`/projects/${id}/fix/${runId}`} className="text-sm text-amber-400 hover:underline">
            打开修复审查 →
          </Link>
        </div>
      )}

      {showFix && id && runId && (
        <div className="px-6 pb-6">
          <FixAnalysisPanel
            loading={fixLoading}
            error={fixError}
            fix={fix}
            onAnalyze={() => void analyzeFix()}
            projectId={id}
          />
        </div>
      )}
    </div>
  );
}
