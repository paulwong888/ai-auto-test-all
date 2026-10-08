import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

export function GlobalLlmSettingsPage() {
  const [provider, setProvider] = useState<LlmProvider>("dashscope");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [extraModelsText, setExtraModelsText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const data = await fetchJson<LlmSettings>("/api/settings/llm");
    setProvider(data.provider as LlmProvider);
    setBaseUrl(data.baseUrl);
    setDefaultModel(data.defaultModel);
    setExtraModelsText((data.extraModels ?? []).join("\n"));
    setHasApiKey(data.hasApiKey);
    setApiKey("");
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const extraModels = extraModelsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        provider,
        baseUrl,
        defaultModel,
        extraModels,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      await fetchJson<LlmSettings>("/api/settings/llm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setMessage("全局模型配置已保存");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">全局模型配置</h1>
        <p className="text-slate-400 text-sm mt-1">
          Plan / Code / Fix 等 Pi 任务默认使用此配置；各项目可在项目设置中覆盖。
        </p>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {message && <p className="text-emerald-400 text-sm">{message}</p>}

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 rounded-lg border border-slate-700 p-4">
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
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
          />
        </label>

        <label className="block text-sm space-y-1">
          <span className="text-slate-400">Default Model</span>
          <input
            type="text"
            required
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
          />
        </label>

        <label className="block text-sm space-y-1">
          <span className="text-slate-400">Extra Models（逗号或换行分隔）</span>
          <textarea
            value={extraModelsText}
            onChange={(e) => setExtraModelsText(e.target.value)}
            rows={3}
            className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
          />
        </label>

        <label className="block text-sm space-y-1">
          <span className="text-slate-400">API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasApiKey ? "已配置，留空则不修改" : "请输入 API Key"}
            className="w-full rounded bg-slate-800 border border-slate-600 px-3 py-2 font-mono text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded bg-emerald-600 text-sm disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </form>

      <p className="text-xs text-slate-500">
        生产环境请配置 <code className="font-mono">MASTER_KEY</code> 用于加密存储 API Key。
        Docker <code className="font-mono">.env</code> 中的 Key 仅作首次种子与回退。
      </p>

      <Link to="/projects" className="text-sm text-emerald-400">
        ← 返回项目列表
      </Link>
    </div>
  );
}
