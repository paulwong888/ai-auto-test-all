import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";

type LlmProvider = "dashscope" | "higress" | "openai-compatible";

interface LlmSettings {
  provider: LlmProvider;
  baseUrl: string;
  defaultModel: string;
  extraModels: string[];
  hasApiKey: boolean;
  updatedAt: string;
}

interface ProjectLlmSettings extends LlmSettings {
  enabled: boolean;
  effective: LlmSettings;
}

export function ProjectLlmSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<LlmProvider>("dashscope");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [extraModelsText, setExtraModelsText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [effective, setEffective] = useState<LlmSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setError(null);
    const data = await fetchJson<ProjectLlmSettings>(`/api/projects/${id}/settings/llm`);
    setEnabled(data.enabled);
    setProvider(data.provider as LlmProvider);
    setBaseUrl(data.baseUrl);
    setDefaultModel(data.defaultModel);
    setExtraModelsText((data.extraModels ?? []).join("\n"));
    setHasApiKey(data.hasApiKey);
    setEffective(data.effective);
    setApiKey("");
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [id]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const extraModels = extraModelsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        enabled,
        provider,
        baseUrl,
        defaultModel,
        extraModels,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      await fetchJson<ProjectLlmSettings>(`/api/projects/${id}/settings/llm`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setMessage("项目模型配置已保存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">项目模型配置</h1>
          <p className="text-slate-400 text-sm mt-1">覆盖全局默认，仅影响本项目的 Pi 任务</p>
        </div>
        <Link to={`/projects/${id}`} className="text-sm text-emerald-400">
          ← 项目概览
        </Link>
      </div>

      {effective && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 text-sm space-y-1">
          <p className="text-slate-400">当前生效</p>
          <p>
            <span className="text-slate-500">Provider</span> {effective.provider} ·{" "}
            <span className="text-slate-500">Model</span> {effective.defaultModel}
          </p>
          <p className="font-mono text-xs text-slate-500 truncate">{effective.baseUrl}</p>
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {message && <p className="text-emerald-400 text-sm">{message}</p>}

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 rounded-lg border border-slate-700 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          使用项目专属配置
        </label>

        <fieldset disabled={!enabled} className="space-y-4 disabled:opacity-50">
          <label className="block text-sm space-y-1">
            <span className="text-slate-400">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as LlmProvider)}
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2"
            >
              <option value="dashscope">dashscope</option>
              <option value="higress">higress</option>
              <option value="openai-compatible">openai-compatible</option>
            </select>
          </label>

          <label className="block text-sm space-y-1">
            <span className="text-slate-400">Base URL</span>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
            />
          </label>

          <label className="block text-sm space-y-1">
            <span className="text-slate-400">Default Model</span>
            <input
              type="text"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
            />
          </label>

          <label className="block text-sm space-y-1">
            <span className="text-slate-400">Extra Models</span>
            <textarea
              value={extraModelsText}
              onChange={(e) => setExtraModelsText(e.target.value)}
              rows={3}
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
            />
          </label>

          <label className="block text-sm space-y-1">
            <span className="text-slate-400">API Key（可选覆盖）</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? "已配置，留空则不修改" : "留空则继承全局 Key"}
              className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
            />
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </form>
    </div>
  );
}
