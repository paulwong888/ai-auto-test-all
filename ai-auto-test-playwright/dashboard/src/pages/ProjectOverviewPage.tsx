import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import type { Project, TrendPoint, WorkflowState } from "../types/project.js";

const STAGE_ORDER = ["init", "recorded", "plan", "code", "run"] as const;

interface EnvRow {
  key: string;
  value: string;
  isSecret: boolean;
  hasValue: boolean;
}

interface ProjectEnvSettings {
  variables: EnvRow[];
  updatedAt: string | null;
}

export function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [envBusy, setEnvBusy] = useState(false);
  const [envMessage, setEnvMessage] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    const [p, w, env] = await Promise.all([
      fetchJson<Project>(`/api/projects/${id}`),
      fetchJson<WorkflowState>(`/api/projects/${id}/workflow`),
      fetchJson<ProjectEnvSettings>(`/api/projects/${id}/settings/env`).catch(() => ({
        variables: [],
        updatedAt: null,
      })),
    ]);
    setProject(p);
    setWorkflow(w);
    setEnvRows(
      env.variables.map((v) => ({
        key: v.key,
        value: v.isSecret ? "" : (v.value ?? ""),
        isSecret: v.isSecret,
        hasValue: v.hasValue,
      })),
    );
    const t = await fetchJson<{ trend: TrendPoint[] }>(`/api/projects/${id}/stats/trend?days=7`).catch(() => ({ trend: [] }));
    setTrend(t.trend);
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [id]);

  const addEnvRow = () => {
    setEnvRows((rows) => [...rows, { key: "", value: "", isSecret: false, hasValue: false }]);
  };

  const updateEnvRow = (index: number, patch: Partial<EnvRow>) => {
    setEnvRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeEnvRow = (index: number) => {
    setEnvRows((rows) => rows.filter((_, i) => i !== index));
  };

  const saveEnv = async () => {
    if (!id) return;
    setEnvBusy(true);
    setError(null);
    setEnvMessage(null);
    try {
      const variables = envRows
        .map((row) => ({
          key: row.key.trim(),
          value: row.value,
          isSecret: row.isSecret,
        }))
        .filter((row) => row.key.length > 0);
      const saved = await fetchJson<ProjectEnvSettings>(`/api/projects/${id}/settings/env`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables }),
      });
      setEnvRows(
        saved.variables.map((v) => ({
          key: v.key,
          value: v.isSecret ? "" : (v.value ?? ""),
          isSecret: v.isSecret,
          hasValue: v.hasValue,
        })),
      );
      setEnvMessage("运行环境变量已保存");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存环境变量失败");
    } finally {
      setEnvBusy(false);
    }
  };

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
        <div className="rounded-lg border border-slate-700/80 p-4 space-y-3">
          <div>
            <h3 className="font-medium text-sm">运行环境变量</h3>
            <p className="text-xs text-slate-500 mt-1">
              Run 执行时注入 pytest 进程（如 <code className="text-slate-400">SALES_PORTAL_CRM_API_BEARER</code>、
              <code className="text-slate-400">SALES_PORTAL_TOPUP_URL</code>）。敏感项留空表示不修改已保存的值。
            </p>
          </div>
          {envMessage && <p className="text-emerald-400 text-xs">{envMessage}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-700">
                  <th className="py-2 pr-2 font-normal">变量名</th>
                  <th className="py-2 pr-2 font-normal">值</th>
                  <th className="py-2 pr-2 font-normal w-16">敏感</th>
                  <th className="py-2 w-16 font-normal" />
                </tr>
              </thead>
              <tbody>
                {envRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-slate-500 text-xs">
                      暂无变量，点击下方添加（示例：Bearer 标记敏感，Topup URL 非敏感）。
                    </td>
                  </tr>
                )}
                {envRows.map((row, index) => (
                  <tr key={`${row.key}-${index}`} className="border-b border-slate-800/80">
                    <td className="py-2 pr-2 align-top">
                      <input
                        type="text"
                        value={row.key}
                        onChange={(e) => updateEnvRow(index, { key: e.target.value.toUpperCase() })}
                        placeholder="SALES_PORTAL_CRM_API_BEARER"
                        className="w-full min-w-[12rem] bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                      />
                    </td>
                    <td className="py-2 pr-2 align-top">
                      <input
                        type={row.isSecret ? "password" : "text"}
                        value={row.value}
                        onChange={(e) => updateEnvRow(index, { value: e.target.value })}
                        placeholder={
                          row.isSecret
                            ? row.hasValue
                              ? "留空则不修改"
                              : "首次保存必填"
                            : "https://…/topupMultipleWallet"
                        }
                        className="w-full min-w-[14rem] bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="py-2 pr-2 align-top text-center">
                      <input
                        type="checkbox"
                        checked={row.isSecret}
                        onChange={(e) => updateEnvRow(index, { isSecret: e.target.checked, value: "" })}
                        className="rounded border-slate-600"
                      />
                    </td>
                    <td className="py-2 align-top">
                      <button
                        type="button"
                        onClick={() => removeEnvRow(index)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addEnvRow}
              className="px-3 py-1.5 rounded border border-slate-600 text-xs hover:bg-slate-800"
            >
              添加一行
            </button>
            <button
              type="button"
              onClick={() => void saveEnv()}
              disabled={envBusy}
              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-xs disabled:opacity-50"
            >
              {envBusy ? "保存中…" : "保存环境变量"}
            </button>
          </div>
        </div>

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
              <Link
                to={`/projects/${id}/settings/llm`}
                className="px-4 py-2 rounded border border-slate-600 text-sm hover:bg-slate-800"
              >
                模型
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
