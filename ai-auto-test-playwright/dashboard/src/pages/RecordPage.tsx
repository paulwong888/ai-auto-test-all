import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchJson, uploadFile } from "../api/client.js";
import { useWorkflow } from "../hooks/useWorkflow.js";
import type { Project } from "../types/project.js";
import { buildVncEmbedUrl, waitForVncReady } from "../utils/vncEmbed.js";

type RecordTab = "upload" | "web";

interface RecordStartResponse {
  sessionId: string;
  vncUrl: string;
  vncToken?: string;
  outputPath: string;
}

function recordStartErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "启动录制失败";
  if (msg.includes("Project recorder session limit")) {
    return "该项目已有进行中的录制会话，请稍候重试或刷新页面";
  }
  if (msg.includes("Global recorder session limit")) {
    return "系统录制会话已满，请停止其他项目的录制后重试";
  }
  return msg;
}

export function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const { workflow } = useWorkflow(id);
  const [tab, setTab] = useState<RecordTab>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [moduleName, setModuleName] = useState("saucedemo");
  const [baseUrl, setBaseUrl] = useState("https://www.saucedemo.com");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [vncSrc, setVncSrc] = useState<string | null>(null);
  const [vncFullscreen, setVncFullscreen] = useState(false);

  useEffect(() => {
    if (!vncFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVncFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [vncFullscreen]);

  useEffect(() => {
    if (!id) return;
    void fetchJson<Project>(`/api/projects/${id}`)
      .then((p) => setBaseUrl(p.baseUrl))
      .catch(() => undefined);
  }, [id]);

  const codegenCommand = useMemo(
    () =>
      `npx playwright codegen ${baseUrl} --target python-pytest -o tests/recorded/${moduleName || "saucedemo"}.py`,
    [baseUrl, moduleName],
  );

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setMessage(`已复制 ${label}，请在 VNC 浏览器内点击输入框后 Cmd+V / Ctrl+V 粘贴`);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const copyCommand = async () => {
    await copyText(codegenCommand, "codegen 命令");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("moduleName", moduleName);
      await uploadFile(`/api/projects/${id}/record/upload`, fd);
      setMessage("录制文件已上传");
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const startWebRecording = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setVncSrc(null);
    setVncFullscreen(false);
    try {
      if (workflow?.stage === "init") {
        await fetchJson(`/api/projects/${id}/init-template`, { method: "POST" });
      }

      const data = await fetchJson<RecordStartResponse>(`/api/projects/${id}/record/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleName, targetUrl: baseUrl }),
      });
      setSessionId(data.sessionId);

      const vncPageUrl = buildVncEmbedUrl(data.vncUrl, data.vncToken);
      setMessage("Web 录制已启动，正在连接浏览器…");

      await new Promise((r) => window.setTimeout(r, 2000));
      const ready = await waitForVncReady(vncPageUrl);
      if (!ready) {
        setError("录制浏览器启动超时，请停止后重试");
        return;
      }

      setVncSrc(vncPageUrl);
      setMessage("Web 录制已启动，请在下方浏览器中操作");
    } catch (err) {
      setError(recordStartErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const stopWebRecording = async () => {
    if (!id || !sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson<{ outputPath: string }>(`/api/projects/${id}/record/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setSessionId(null);
      setVncSrc(null);
      setVncFullscreen(false);
      setMessage(`录制已停止，文件已保存至 ${data.outputPath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "停止录制失败");
    } finally {
      setBusy(false);
    }
  };

  const tabClass = (key: RecordTab) =>
    key === tab
      ? "px-3 py-1.5 text-sm rounded-t bg-slate-700 text-white border border-b-0 border-slate-600"
      : "px-3 py-1.5 text-sm rounded-t bg-slate-800/60 text-slate-400 border border-transparent hover:text-slate-200";

  return (
    <div
      className={`space-y-6 ${tab === "web" && vncSrc ? "max-w-6xl" : "max-w-4xl"}`}
    >
      <div>
        <h1 className="text-2xl font-semibold">录制</h1>
        <p className="text-slate-400 text-sm mt-1">本地上传 Playwright codegen 文件，或在 Web 内直接录制</p>
      </div>

      <div className="flex gap-1 border-b border-slate-700">
        <button type="button" className={tabClass("upload")} onClick={() => setTab("upload")}>
          本地上传
        </button>
        <button type="button" className={tabClass("web")} onClick={() => setTab("web")}>
          Web 录制
        </button>
      </div>

      {tab === "upload" && (
        <>
          <div className="rounded-lg border border-slate-700 p-4 space-y-3">
            <h2 className="font-medium text-sm">本地录制命令</h2>
            <pre className="text-xs font-mono bg-slate-900/80 p-3 rounded overflow-x-auto text-emerald-200/90">
              {codegenCommand}
            </pre>
            <button
              type="button"
              onClick={() => void copyCommand()}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              {copied ? "已复制" : "复制命令"}
            </button>
          </div>

          <form onSubmit={onSubmit} className="rounded-lg border border-slate-700 p-4 space-y-4">
            <input
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
              placeholder="模块名 (moduleName)"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              required
            />
            <input
              type="file"
              accept=".py"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-slate-300"
            />
            <button
              type="submit"
              disabled={!file || busy}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
            >
              {busy ? "上传中…" : "上传录制"}
            </button>
          </form>
        </>
      )}

      {tab === "web" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 p-4 space-y-4">
            <input
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
              placeholder="模块名 (moduleName)"
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              required
            />
            <input
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
              placeholder="目标 URL"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !!sessionId}
                onClick={() => void startWebRecording()}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-sm disabled:opacity-50"
              >
                {busy && !sessionId ? "启动中…" : "开始录制"}
              </button>
              <button
                type="button"
                disabled={busy || !sessionId}
                onClick={() => void stopWebRecording()}
                className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-50"
              >
                {busy && sessionId ? "停止中…" : "停止并保存"}
              </button>
            </div>
          </div>

          {vncSrc && (
            <div
              className={
                vncFullscreen
                  ? "fixed inset-0 z-50 flex flex-col bg-black"
                  : "rounded-lg border border-slate-700 overflow-hidden bg-black flex flex-col"
              }
            >
              <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 shrink-0 space-y-2">
                <p className="text-xs text-amber-200/90">
                  键盘提示：noVNC 内若打不出下划线 <code className="text-amber-100">_</code>，请先
                  点击 VNC 画面聚焦，切到<strong className="font-normal text-amber-100">英文输入法</strong>
                  （Mac：Shift+-），或下方复制后粘贴。
                </p>
                {baseUrl.includes("saucedemo.com") && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyText("standard_user", "用户名")}
                      className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600"
                    >
                      复制用户名 standard_user
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyText("secret_sauce", "密码")}
                      className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600"
                    >
                      复制密码 secret_sauce
                    </button>
                  </div>
                )}
                <p className="text-xs text-slate-400">
                  画面会自动缩放适配窗口；仍看不全时可点「全屏」，或在 noVNC 侧边栏确认 Scaling mode 为 Local scaling。
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setVncFullscreen((v) => !v)}
                    className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
                  >
                    {vncFullscreen ? "退出全屏 (Esc)" : "全屏"}
                  </button>
                </div>
              </div>
              <iframe
                title="Web 录制浏览器"
                src={vncSrc}
                className={
                  vncFullscreen
                    ? "flex-1 w-full min-h-0 border-0"
                    : "w-full min-h-[480px] h-[calc(100vh-15rem)] border-0"
                }
                allow="clipboard-read; clipboard-write"
              />
            </div>
          )}
        </div>
      )}

      {message && <p className="text-emerald-400 text-sm">{message}</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
