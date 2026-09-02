import { useEffect, useState } from "react";
import type { AuthMode, Project, ProjectValidation } from "../types/project";

interface Props {
  open: boolean;
  projects: Project[];
  allowedPrefixes: string[];
  onClose: () => void;
  onChanged: () => void;
}

interface FormState {
  name: string;
  repoPath: string;
  targetUrl: string;
  authMode: AuthMode;
  e2eUsername: string;
  e2ePassword: string;
}

interface InitTemplateResult {
  created: string[];
  skipped: string[];
  warnings?: string[];
}

const emptyForm: FormState = {
  name: "",
  repoPath: "",
  targetUrl: "http://host.docker.internal:8037",
  authMode: "none",
  e2eUsername: "",
  e2ePassword: "",
};

function initTemplateBody(form: FormState, projectId?: string) {
  const payload: Record<string, string> = {};
  if (!projectId) {
    payload.repoPath = form.repoPath;
    payload.targetUrl = form.targetUrl;
  }
  payload.authMode = form.authMode;
  if (form.authMode === "keycloak") {
    if (form.e2eUsername) payload.e2eUsername = form.e2eUsername;
    if (form.e2ePassword) payload.e2ePassword = form.e2ePassword;
  }
  return payload;
}

export default function ProjectManager({
  open,
  projects,
  allowedPrefixes,
  onClose,
  onChanged,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<ProjectValidation | null>(null);
  const [initResult, setInitResult] = useState<InitTemplateResult | null>(null);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setForm(emptyForm);
      setError("");
      setValidation(null);
      setInitResult(null);
      setWizardStep(1);
    }
  }, [open]);

  if (!open) return null;

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setValidation(null);
  };

  const startEdit = (project: Project) => {
    setEditingId(project.id);
    setForm({
      name: project.name,
      repoPath: project.repoPath,
      targetUrl: project.targetUrl,
      authMode: project.authMode ?? "none",
      e2eUsername: "",
      e2ePassword: "",
    });
    setError("");
    setValidation(null);
  };

  const projectPayload = () => ({
    name: form.name,
    repoPath: form.repoPath,
    targetUrl: form.targetUrl,
    authMode: form.authMode,
  });

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const url = editingId ? `/api/projects/${editingId}` : "/api/projects";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectPayload()),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onChanged();
      startCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("確定刪除此專案？")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onChanged();
      if (editingId === id) startCreate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const validate = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${id}/validate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setValidation(data.validation);
      if (data.validation.ok) setWizardStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const initTemplate = async (projectId?: string) => {
    setBusy(true);
    setError("");
    setInitResult(null);
    try {
      const url = projectId
        ? `/api/projects/${projectId}/init-template`
        : "/api/projects/init-template";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initTemplateBody(form, projectId)),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setInitResult(data.result);
      if (data.validation) setValidation(data.validation);
      setWizardStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitAndInit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectPayload()),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onChanged();
      await initTemplate(data.project.id);
      setEditingId(data.project.id);
      setWizardStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-slate-900 border border-slate-700 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200">專案管理</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-sm"
          >
            關閉
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="text-xs font-medium text-slate-400 mb-2">接入向導</p>
            <ol className="text-xs text-slate-500 space-y-1 list-decimal list-inside">
              <li className={wizardStep >= 1 ? "text-emerald-400" : ""}>填寫專案資訊並建立</li>
              <li className={wizardStep >= 2 ? "text-emerald-400" : ""}>一鍵初始化 .pi / tests/e2e / Playwright</li>
              <li className={wizardStep >= 3 ? "text-emerald-400" : ""}>校驗通過 → 關閉後點「重新審計」</li>
            </ol>
          </div>

          <div className="text-xs text-slate-500 space-y-1">
            <p>原始碼路徑須落在以下前綴之一：</p>
            <ul className="list-disc list-inside">
              {allowedPrefixes.map((p) => (
                <li key={p}>
                  <code className="text-slate-400">{p}/</code>
                </li>
              ))}
            </ul>
            <p className="pt-1">
              範例：<code className="text-slate-400">/app/sandbox-repos/my-app</code> 或{" "}
              <code className="text-slate-400">/data/repos/your-frontend</code>
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-800 p-4">
            <h3 className="text-xs font-medium text-slate-400">
              {editingId ? "編輯專案" : "新增專案"}
            </h3>
            <input
              type="text"
              placeholder="專案名稱"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full text-sm rounded-lg bg-slate-950 border border-slate-700 px-3 py-2"
            />
            <input
              type="text"
              placeholder="原始碼路徑（容器內絕對路徑）"
              value={form.repoPath}
              onChange={(e) => setForm((f) => ({ ...f, repoPath: e.target.value }))}
              className="w-full text-sm rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
            />
            <input
              type="url"
              placeholder="被測 URL"
              value={form.targetUrl}
              onChange={(e) => setForm((f) => ({ ...f, targetUrl: e.target.value }))}
              className="w-full text-sm rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
            />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={form.authMode === "keycloak"}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    authMode: e.target.checked ? "keycloak" : "none",
                  }))
                }
              />
              需要 SSO / Keycloak 登入
            </label>
            {form.authMode === "keycloak" && (
              <div className="space-y-2 pl-1 border-l-2 border-cyan-900 ml-1">
                <input
                  type="text"
                  placeholder="E2E 測試帳號 (E2E_USERNAME)"
                  value={form.e2eUsername}
                  onChange={(e) => setForm((f) => ({ ...f, e2eUsername: e.target.value }))}
                  className="w-full text-sm rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
                />
                <input
                  type="password"
                  placeholder="E2E 測試密碼 (E2E_PASSWORD)"
                  value={form.e2ePassword}
                  onChange={(e) => setForm((f) => ({ ...f, e2ePassword: e.target.value }))}
                  className="w-full text-sm rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-xs"
                />
                <p className="text-xs text-amber-400/90">
                  targetUrl 須為 Keycloak 已登記的 redirect_uri（例如 http://172.26.9.212:8026）
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !form.name || !form.repoPath || !form.targetUrl}
                onClick={() => void submit()}
                className="px-3 py-1.5 text-xs rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40"
              >
                {editingId ? "儲存" : "建立"}
              </button>
              {!editingId && (
                <button
                  type="button"
                  disabled={busy || !form.name || !form.repoPath || !form.targetUrl}
                  onClick={() => void submitAndInit()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-cyan-800 hover:bg-cyan-700 disabled:opacity-40"
                >
                  建立並初始化模板
                </button>
              )}
              {form.repoPath && !editingId && (
                <button
                  type="button"
                  disabled={busy || !form.repoPath}
                  onClick={() => void initTemplate()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700 disabled:opacity-40"
                >
                  僅初始化模板（路徑）
                </button>
              )}
              {editingId && (
                <button
                  type="button"
                  onClick={startCreate}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 border border-slate-700"
                >
                  取消編輯
                </button>
              )}
            </div>
          </div>

          {initResult && (
            <div className="text-xs rounded-lg p-3 border border-cyan-900/50 bg-cyan-950/20 text-cyan-200">
              <p className="font-medium mb-1">模板初始化完成</p>
              {initResult.created.length > 0 && (
                <p>已建立：{initResult.created.join(", ")}</p>
              )}
              {initResult.skipped.length > 0 && (
                <p className="text-slate-400 mt-1">已存在略過：{initResult.skipped.join(", ")}</p>
              )}
              {initResult.warnings && initResult.warnings.length > 0 && (
                <ul className="mt-2 list-disc list-inside text-amber-300">
                  {initResult.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          {validation && (
            <div
              className={`text-xs rounded-lg p-3 border ${
                validation.ok
                  ? "border-emerald-800 text-emerald-300 bg-emerald-950/40"
                  : "border-amber-800 text-amber-200 bg-amber-950/30"
              }`}
            >
              <p>{validation.ok ? "專案路徑校驗通過" : "專案路徑校驗未通過"}</p>
              {validation.messages.length > 0 && (
                <ul className="mt-1 list-disc list-inside">
                  {validation.messages.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
            {projects.length === 0 && (
              <li className="px-4 py-3 text-sm text-slate-500">暫無專案，請先建立</li>
            )}
            {projects.map((p) => (
              <li key={p.id} className="px-4 py-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200">{p.name}</p>
                  <p className="text-xs text-slate-500 font-mono truncate">{p.repoPath}</p>
                  <p className="text-xs text-slate-500 font-mono truncate">{p.targetUrl}</p>
                  {p.authMode === "keycloak" && (
                    <p className="text-xs text-cyan-500">SSO / Keycloak</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => void initTemplate(p.id)}
                    disabled={busy}
                    className="px-2 py-1 text-xs rounded bg-cyan-950 border border-cyan-900 text-cyan-300"
                  >
                    初始化模板
                  </button>
                  <button
                    type="button"
                    onClick={() => void validate(p.id)}
                    disabled={busy}
                    className="px-2 py-1 text-xs rounded bg-slate-800 border border-slate-700"
                  >
                    校驗
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="px-2 py-1 text-xs rounded bg-slate-800 border border-slate-700"
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(p.id)}
                    disabled={busy}
                    className="px-2 py-1 text-xs rounded bg-red-950 border border-red-900 text-red-300"
                  >
                    刪除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
