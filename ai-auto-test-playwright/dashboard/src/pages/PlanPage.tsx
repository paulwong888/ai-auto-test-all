import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import { useJobPoll } from "../hooks/useJobPoll.js";
import { useWorkflow } from "../hooks/useWorkflow.js";
import { defaultModuleFromWorkspace } from "../utils/projectModule.js";

interface PlanVersion {
  id: string;
  versionNumber: number;
  source: "ai" | "user";
  message: string | null;
  createdAt: string;
  content?: string;
}

export function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const { pollJob } = useJobPoll();
  const { workflow } = useWorkflow(id);
  const [markdown, setMarkdown] = useState<string>("");
  const [editContent, setEditContent] = useState<string>("");
  const [moduleName, setModuleName] = useState<string>("");
  const [planVersionId, setPlanVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [diffPick, setDiffPick] = useState<string[]>([]);
  const [recordedModules, setRecordedModules] = useState<string[]>([]);
  /** 避免 workflow 5s 轮询反复把模块切回默认项 */
  const didInitialModuleLoad = useRef(false);
  /** 忽略过期的 loadPlan/loadVersions 响应（初始加载与用户切换并发时） */
  const planLoadSeq = useRef(0);

  const loadVersions = useCallback(
    async (mod: string, seq: number) => {
      if (!id || !mod) return;
      try {
        const qs = new URLSearchParams({ moduleName: mod });
        const data = await fetchJson<{ versions: PlanVersion[] }>(
          `/api/projects/${id}/plan/versions?${qs.toString()}`,
        );
        if (planLoadSeq.current !== seq) return;
        setVersions(data.versions ?? []);
      } catch {
        if (planLoadSeq.current !== seq) return;
        setVersions([]);
      }
    },
    [id],
  );

  const loadPlan = useCallback(
    async (mod: string, seq: number) => {
      if (!id || !mod) return;
      try {
        const qs = new URLSearchParams({ moduleName: mod });
        const data = await fetchJson<{
          content: string;
          moduleName: string;
          planVersionId: string | null;
        }>(`/api/projects/${id}/plan?${qs.toString()}`);
        if (planLoadSeq.current !== seq) return;
        setMarkdown(data.content ?? "");
        setEditContent(data.content ?? "");
        setModuleName(data.moduleName ?? mod);
        setPlanVersionId(data.planVersionId);
      } catch {
        if (planLoadSeq.current !== seq) return;
        setMarkdown("");
        setEditContent("");
        setPlanVersionId(null);
        setModuleName(mod);
      }
    },
    [id],
  );

  useEffect(() => {
    didInitialModuleLoad.current = false;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void fetchJson<{ modules: string[] }>(`/api/projects/${id}/recorded-modules`)
      .then((d) => setRecordedModules(d.modules ?? []))
      .catch(() => setRecordedModules([]));
  }, [id]);

  const switchModule = useCallback(
    async (mod: string) => {
      const trimmed = mod.trim();
      if (!trimmed) return;
      const seq = ++planLoadSeq.current;
      setModuleName(trimmed);
      setEditing(false);
      setDiffPick([]);
      await Promise.all([loadPlan(trimmed, seq), loadVersions(trimmed, seq)]);
    },
    [loadPlan, loadVersions],
  );

  useEffect(() => {
    if (!id || !workflow || didInitialModuleLoad.current) return;
    didInitialModuleLoad.current = true;
    const fallback = defaultModuleFromWorkspace(workflow.workspacePath);
    const browseDefault =
      workflow.moduleName === "saucedemo" ? fallback : workflow.moduleName?.trim() || fallback;
    void switchModule(browseDefault);
  }, [id, workflow, switchModule]);

  const generatePlan = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const mod = moduleName.trim();
      if (!mod) throw new Error("请先选择或填写计划模块名");
      const { jobId } = await fetchJson<{ jobId: string }>(`/api/projects/${id}/plan/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleName: mod }),
      });
      const job = await pollJob(jobId);
      if (job.status === "failed") throw new Error(job.error ?? "计划生成失败");
      await switchModule(mod);
      setMessage("测试计划已生成");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await fetchJson<PlanVersion>(`/api/projects/${id}/plan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editContent,
          baseVersionId: planVersionId ?? undefined,
          moduleName: moduleName || undefined,
        }),
      });
      setPlanVersionId(saved.id);
      setMarkdown(editContent);
      setEditing(false);
      await switchModule(moduleName || "sales-portal");
      setMessage(`已保存 v${saved.versionNumber}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const loadVersion = async (versionId: string) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const v = await fetchJson<PlanVersion>(`/api/projects/${id}/plan/versions/${versionId}`);
      setMarkdown(v.content ?? "");
      setEditContent(v.content ?? "");
      setPlanVersionId(v.id);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载版本失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleDiffPick = (versionId: string) => {
    setDiffPick((prev) => {
      if (prev.includes(versionId)) return prev.filter((x) => x !== versionId);
      if (prev.length >= 2) return [prev[1]!, versionId];
      return [...prev, versionId];
    });
  };

  const showDiff = async () => {
    if (!id || diffPick.length !== 2) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson<{ diff: string }>(
        `/api/projects/${id}/plan/diff?v1=${diffPick[0]}&v2=${diffPick[1]}`,
      );
      setDiffText(data.diff);
    } catch (err) {
      setError(err instanceof Error ? err.message : "对比失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmAndGenerateCode = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { jobId } = await fetchJson<{ jobId: string }>(`/api/projects/${id}/code/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmPlan: true,
          moduleName: moduleName || undefined,
          planVersionId: planVersionId ?? undefined,
        }),
      });
      const job = await pollJob(jobId);
      if (job.status === "failed") throw new Error(job.error ?? "代码生成失败");
      setMessage("代码已生成，请前往「代码」页查看");
    } catch (err) {
      setError(err instanceof Error ? err.message : "代码生成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">测试计划</h1>
          <p className="text-slate-400 text-sm mt-1">
            预览、编辑并保存计划版本
            {planVersionId && (
              <span className="ml-2 font-mono text-xs text-slate-500">
                当前版本 {planVersionId.slice(0, 8)}
              </span>
            )}
          </p>
          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-400">计划模块</span>
            <select
              value={moduleName}
              onChange={(e) => void switchModule(e.target.value)}
              disabled={busy || editing}
              className="rounded bg-slate-800 border border-slate-600 px-2 py-1 min-w-[14rem]"
            >
              {recordedModules.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {moduleName && !recordedModules.includes(moduleName) && (
                <option value={moduleName}>{moduleName}</option>
              )}
            </select>
            <input
              type="text"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (moduleName.trim()) void switchModule(moduleName.trim());
                }
              }}
              disabled={busy || editing}
              placeholder="新模块名，Enter 加载"
              className="rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-mono min-w-[10rem]"
            />
            <span className="text-xs text-slate-500">tests/plans/{moduleName || "…"}-test-plan.md</span>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing((e) => !e);
              setEditContent(markdown);
            }}
            disabled={busy || !markdown}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-50"
          >
            {editing ? "预览" : "编辑"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => void savePlan()}
              disabled={busy}
              className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-sm disabled:opacity-50"
            >
              保存版本
            </button>
          )}
          <button
            type="button"
            onClick={() => void generatePlan()}
            disabled={busy}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-50"
          >
            {busy ? "处理中…" : "生成计划"}
          </button>
          <button
            type="button"
            onClick={() => void confirmAndGenerateCode()}
            disabled={busy || !markdown}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
          >
            确认并生成代码
          </button>
        </div>
      </div>

      {message && <p className="text-emerald-400 text-sm">{message}</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 rounded-lg border border-slate-700 p-6">
          {editing ? (
            <textarea
              className="w-full min-h-[480px] rounded bg-slate-900 border border-slate-600 p-4 text-sm font-mono text-slate-200"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
            />
          ) : markdown ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-slate-500">暂无计划，点击「生成计划」开始</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm">版本历史</h2>
            <button
              type="button"
              onClick={() => void showDiff()}
              disabled={diffPick.length !== 2 || busy}
              className="text-xs text-emerald-400 hover:underline disabled:opacity-40"
            >
              对比
            </button>
          </div>
          <ul className="space-y-2 max-h-96 overflow-auto text-sm">
            {versions.map((v) => (
              <li key={v.id} className="rounded border border-slate-700 p-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={diffPick.includes(v.id)}
                    onChange={() => toggleDiffPick(v.id)}
                    className="mt-1"
                  />
                  <button
                    type="button"
                    onClick={() => void loadVersion(v.id)}
                    className="text-left flex-1 hover:text-emerald-300"
                  >
                    <div>
                      v{v.versionNumber}{" "}
                      <span className="text-xs text-slate-500">({v.source})</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(v.createdAt).toLocaleString()}
                    </div>
                    {v.message && <div className="text-xs text-slate-400 mt-1">{v.message}</div>}
                  </button>
                </label>
              </li>
            ))}
            {versions.length === 0 && (
              <li className="text-slate-500 text-xs">生成计划后将出现版本记录</li>
            )}
          </ul>
        </div>
      </div>

      {diffText && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-4xl w-full max-h-[80vh] flex flex-col">
            <div className="px-4 py-3 border-b border-slate-700 flex justify-between items-center">
              <h3 className="font-medium">版本 Diff</h3>
              <button
                type="button"
                onClick={() => setDiffText(null)}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                关闭
              </button>
            </div>
            <pre className="p-4 text-xs font-mono overflow-auto flex-1 text-slate-300">{diffText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
