import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import { useJobPoll } from "../hooks/useJobPoll.js";
import type { FixPatch, FixSuggestion } from "../types/project.js";

export function FixReviewPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { pollJob } = useJobPoll();
  const [fix, setFix] = useState<FixSuggestion | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFix = async () => {
    if (!id || !runId) return;
    const data = await fetchJson<FixSuggestion>(`/api/projects/${id}/runs/${runId}/fix`);
    setFix(data);
    if (data.patches?.length) setSelected(data.patches.map((_, i) => i));
  };

  useEffect(() => {
    void loadFix().catch(() => setFix(null));
  }, [id, runId]);

  const analyze = async () => {
    if (!id || !runId) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await fetchJson<{ jobId: string }>(`/api/projects/${id}/fix/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const job = await pollJob(jobId);
      if (job.status === "failed") throw new Error(job.error ?? "分析失败");
      await loadFix();
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (autoVerify: boolean) => {
    if (!id || !fix?.suggestionId || selected.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await fetchJson<{ appliedFiles: string[]; verifyRunId: string | null; iteration: number }>(
        `/api/projects/${id}/fix/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestionId: fix.suggestionId,
            patchIndexes: selected,
            autoVerify,
          }),
        },
      );
      setMessage(
        `已应用 ${data.appliedFiles.length} 个文件（第 ${data.iteration} 轮）${
          data.verifyRunId ? `，验证 run: ${data.verifyRunId.slice(0, 8)}` : ""
        }`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用失败");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">修复审查</h1>
          <p className="text-slate-400 text-sm mt-1">Run {runId?.slice(0, 8)}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={busy}
            className="px-4 py-2 rounded bg-slate-700 text-sm disabled:opacity-50"
          >
            重新分析
          </button>
          <button
            type="button"
            onClick={() => void apply(true)}
            disabled={busy || !fix?.patches?.length}
            className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
          >
            应用并验证
          </button>
        </div>
      </div>

      {message && <p className="text-emerald-400 text-sm">{message}</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!fix && (
        <div className="rounded border border-slate-700 p-6 text-slate-400">
          暂无修复建议，{" "}
          <button type="button" onClick={() => void analyze()} className="text-emerald-400 underline">
            开始分析
          </button>
        </div>
      )}

      {fix && (
        <>
          <div className="prose prose-invert prose-sm max-w-none rounded border border-slate-700 p-4">
            <pre className="whitespace-pre-wrap text-sm">{fix.analysis}</pre>
          </div>

          <div className="space-y-3">
            <h2 className="font-medium">Patches</h2>
            {(fix.patches ?? []).map((patch: FixPatch, index: number) => (
              <div key={index} className="rounded border border-slate-700 p-4">
                <label className="flex items-center gap-2 text-sm mb-2">
                  <input type="checkbox" checked={selected.includes(index)} onChange={() => toggle(index)} />
                  <span className="font-mono">{patch.file}</span>
                  {patch.description && <span className="text-slate-500">— {patch.description}</span>}
                </label>
                <pre className="text-xs font-mono overflow-auto bg-slate-900 p-3 rounded">{patch.unifiedDiff}</pre>
              </div>
            ))}
            {!(fix.patches ?? []).length && (
              <p className="text-slate-500 text-sm">分析结果无 patches，请重新运行 analyze</p>
            )}
          </div>
        </>
      )}

      <Link to={`/projects/${id}/run`} className="text-sm text-emerald-400 hover:underline">
        返回执行页
      </Link>
    </div>
  );
}
