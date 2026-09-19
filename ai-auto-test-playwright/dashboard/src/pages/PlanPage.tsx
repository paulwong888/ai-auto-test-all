import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import { useJobPoll } from "../hooks/useJobPoll.js";

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

  const loadVersions = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchJson<{ versions: PlanVersion[] }>(
        `/api/projects/${id}/plan/versions`,
      );
      setVersions(data.versions ?? []);
    } catch {
      setVersions([]);
    }
  }, [id]);

  const loadPlan = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchJson<{
        content: string;
        moduleName: string;
        planVersionId: string | null;
      }>(`/api/projects/${id}/plan`);
      setMarkdown(data.content ?? "");
      setEditContent(data.content ?? "");
      setModuleName(data.moduleName ?? "");
      setPlanVersionId(data.planVersionId);
    } catch {
      setMarkdown("");
      setEditContent("");
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void loadPlan();
    void loadVersions();
  }, [id, loadPlan, loadVersions]);

  const generatePlan = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { jobId } = await fetchJson<{ jobId: string }>(`/api/projects/${id}/plan/generate`, {
        method: "POST",
      });
      const job = await pollJob(jobId);
      if (job.status === "failed") throw new Error(job.error ?? "计划生成失败");
      await loadPlan();
      await loadVersions();
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
      await loadVersions();
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
