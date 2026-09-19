import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import type { RunCompareResult, RunRecord } from "../types/project.js";

export function HistoryPage() {
  const { id } = useParams<{ id: string }>();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const [compare, setCompare] = useState<RunCompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    if (!id) return;
    const data = await fetchJson<{ runs: RunRecord[] }>(`/api/projects/${id}/runs`);
    setRuns(data.runs);
  }, [id]);

  useEffect(() => {
    void loadRuns().catch(() => undefined);
  }, [loadRuns]);

  const togglePick = (runId: string) => {
    setPick((prev) => {
      if (prev.includes(runId)) return prev.filter((x) => x !== runId);
      if (prev.length >= 2) return [prev[1]!, runId];
      return [...prev, runId];
    });
  };

  const doCompare = async () => {
    if (!id || pick.length !== 2) return;
    setError(null);
    try {
      const data = await fetchJson<RunCompareResult>(
        `/api/projects/${id}/runs/compare?runA=${pick[0]}&runB=${pick[1]}`,
      );
      setCompare(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "对比失败");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">运行历史</h1>
          <p className="text-slate-400 text-sm mt-1">选择两次 run 进行 TC 级对比</p>
        </div>
        <button
          type="button"
          onClick={() => void doCompare()}
          disabled={pick.length !== 2}
          className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-40"
        >
          对比
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <ul className="space-y-2">
        {runs.map((r) => (
          <li key={r.id} className="rounded border border-slate-700 px-4 py-3 flex items-center gap-3">
            <input type="checkbox" checked={pick.includes(r.id)} onChange={() => togglePick(r.id)} />
            <div className="flex-1 text-sm">
              <span className="font-mono text-xs text-slate-500">{r.id.slice(0, 8)}</span>
              <span className="ml-2">{r.status}</span>
              {r.preset && <span className="ml-2 text-xs text-slate-500">({r.preset})</span>}
              <span className="ml-2 text-slate-400">
                {r.passed}P / {r.failed}F
              </span>
              <span className="ml-2 text-xs text-slate-500">
                {r.startedAt ? new Date(r.startedAt).toLocaleString() : ""}
              </span>
            </div>
            <Link to={`/projects/${id}/report/${r.id}`} className="text-xs text-emerald-400">
              报告
            </Link>
          </li>
        ))}
      </ul>

      {compare && (
        <div className="rounded border border-slate-700 p-4 space-y-2 text-sm">
          <h2 className="font-medium">对比结果</h2>
          <p>新增失败: {compare.newFailures.join(", ") || "—"}</p>
          <p>已修复: {compare.fixed.join(", ") || "—"}</p>
          <p>仍失败: {compare.stillFailing.join(", ") || "—"}</p>
          <p>新增通过: {compare.newlyPassing.join(", ") || "—"}</p>
        </div>
      )}
    </div>
  );
}
