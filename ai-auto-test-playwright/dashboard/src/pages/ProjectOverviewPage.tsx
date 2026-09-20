import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import type { Project, TrendPoint, WorkflowState } from "../types/project.js";

const STAGE_ORDER = ["init", "recorded", "plan", "code", "run"] as const;

export function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  const load = async () => {
    if (!id) return;
    const [p, w] = await Promise.all([
      fetchJson<Project>(`/api/projects/${id}`),
      fetchJson<WorkflowState>(`/api/projects/${id}/workflow`),
    ]);
    setProject(p);
    setWorkflow(w);
    const t = await fetchJson<{ trend: TrendPoint[] }>(`/api/projects/${id}/stats/trend?days=7`).catch(() => ({ trend: [] }));
    setTrend(t.trend);
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [id]);

  const initTemplate = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`/api/projects/${id}/init-template`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "初始化失败");
    } finally {
      setBusy(false);
    }
  };

  const stageIdx = workflow ? STAGE_ORDER.indexOf(workflow.stage) : -1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{project?.name ?? "项目概览"}</h1>
        {project && (
          <p className="text-slate-400 text-sm mt-1">
            {project.baseUrl} · 模块 {project.moduleName ?? "—"}
          </p>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {trend.length > 0 && (
        <div className="rounded-lg border border-slate-700 p-4">
          <h2 className="font-medium mb-3">7 日通过率趋势</h2>
          <div className="flex items-end gap-2 h-24">
            {trend.map((point) => (
              <div key={point.date} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-emerald-600/70 rounded-t"
                  style={{ height: `${Math.max(point.passRate * 100, 4)}%` }}
                  title={`${Math.round(point.passRate * 100)}%`}
                />
                <span className="text-[10px] text-slate-500">{point.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-700 p-4 space-y-4">
        <h2 className="font-medium">工作流状态</h2>
        {workflow && (
          <>
            <div className="flex flex-wrap gap-2">
              {STAGE_ORDER.map((s, i) => (
                <span
                  key={s}
                  className={`px-3 py-1 rounded-full text-xs ${
                    s === workflow.stage
                      ? "bg-emerald-600/30 text-emerald-300 ring-1 ring-emerald-500"
                      : i <= stageIdx
                        ? "bg-slate-700 text-slate-300"
                        : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {s}
                </span>
              ))}
            </div>
            <p className="text-sm text-slate-400">
              阶段状态：<span className="text-slate-200">{workflow.stageStatus}</span>
            </p>
            {Object.keys(workflow.artifactPaths).length > 0 && (
              <pre className="text-xs bg-slate-900 rounded p-3 overflow-auto">
                {JSON.stringify(workflow.artifactPaths, null, 2)}
              </pre>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void initTemplate()}
            disabled={busy}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-50"
          >
            {busy ? "初始化中…" : "初始化模板"}
          </button>
          {id && (
            <>
              <Link to={`/projects/${id}/record`} className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-sm">
                去录制
              </Link>
              <Link to={`/projects/${id}/run`} className="px-4 py-2 rounded border border-slate-600 text-sm hover:bg-slate-800">
                去执行
              </Link>
              <Link
                to={`/projects/${id}/settings/members`}
                className="px-4 py-2 rounded border border-slate-600 text-sm hover:bg-slate-800"
              >
                成员
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
