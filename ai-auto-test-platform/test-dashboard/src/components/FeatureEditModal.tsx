import { useEffect, useState } from "react";
import type { FeatureItem, GherkinPhase, ManualAccount, ManualConfig } from "../types";

interface Props {
  projectId: string;
  feature: FeatureItem;
  open: boolean;
  onClose: () => void;
  onSaved: (feature: FeatureItem) => void;
}

function linesToText(lines: string[]): string {
  return lines.join("\n");
}

function textToLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export default function FeatureEditModal({ projectId, feature, open, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(feature.title);
  const [scenario, setScenario] = useState(feature.gherkin.scenario);
  const [givenText, setGivenText] = useState(linesToText(feature.gherkin.given));
  const [whenText, setWhenText] = useState(linesToText(feature.gherkin.when));
  const [andText, setAndText] = useState(linesToText(feature.gherkin.and ?? []));
  const [thenText, setThenText] = useState(linesToText(feature.gherkin.then));
  const [accounts, setAccounts] = useState<ManualAccount[]>(feature.manualConfig?.accounts ?? []);
  const [notes, setNotes] = useState(feature.manualConfig?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(feature.title);
    setScenario(feature.gherkin.scenario);
    setGivenText(linesToText(feature.gherkin.given));
    setWhenText(linesToText(feature.gherkin.when));
    setAndText(linesToText(feature.gherkin.and ?? []));
    setThenText(linesToText(feature.gherkin.then));
    setAccounts(feature.manualConfig?.accounts ?? []);
    setNotes(feature.manualConfig?.notes ?? "");
    setError(null);
  }, [open, feature]);

  if (!open) return null;

  const updateAccount = (index: number, patch: Partial<ManualAccount>) => {
    setAccounts((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const addAccount = () => {
    setAccounts((prev) => [...prev, { role: "agent", username: "", password: "" }]);
  };

  const removeAccount = (index: number) => {
    setAccounts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const manualConfig: ManualConfig = {
        ...(accounts.length > 0 ? { accounts } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(feature.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            gherkin: {
              scenario,
              given: textToLines(givenText),
              when: textToLines(whenText),
              then: textToLines(thenText),
              ...(textToLines(andText).length ? { and: textToLines(andText) } : {}),
            },
            manualConfig,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "保存失败");
      }
      onSaved(data.feature as FeatureItem);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const phaseLabel: Record<GherkinPhase, string> = {
    given: "Given 假设",
    when: "When 当",
    and: "And 并且",
    then: "Then 那么",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-100">编辑剧本</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-200">
            关闭
          </button>
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-slate-400">标题</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs text-slate-400">Scenario</span>
          <input
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </label>

        {(
          [
            ["given", givenText, setGivenText],
            ["when", whenText, setWhenText],
            ["and", andText, setAndText],
            ["then", thenText, setThenText],
          ] as const
        ).map(([phase, value, setter]) => (
          <label key={phase} className="block space-y-1">
            <span className="text-xs text-slate-400">{phaseLabel[phase]}（每行一步）</span>
            <textarea
              value={value}
              onChange={(e) => setter(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono"
            />
          </label>
        ))}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">测试帐号</span>
            <button
              type="button"
              onClick={addAccount}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              + 添加帐号
            </button>
          </div>
          {accounts.map((acc, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 p-2">
              <input
                placeholder="角色 role"
                value={acc.role}
                onChange={(e) => updateAccount(i, { role: e.target.value })}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              />
              <input
                placeholder="用户名"
                value={acc.username}
                onChange={(e) => updateAccount(i, { username: e.target.value })}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              />
              <input
                placeholder="密码"
                type="password"
                value={acc.password ?? ""}
                onChange={(e) => updateAccount(i, { password: e.target.value })}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              />
              <input
                placeholder="备注"
                value={acc.note ?? ""}
                onChange={(e) => updateAccount(i, { note: e.target.value })}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => removeAccount(i)}
                className="col-span-2 text-xs text-red-400 hover:text-red-300 text-left"
              >
                删除此帐号
              </button>
            </div>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="text-xs text-slate-400">备注</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-700 text-slate-300"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
