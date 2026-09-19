import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FixSuggestion } from "../types/project.js";

interface Props {
  loading: boolean;
  error: string | null;
  fix: FixSuggestion | null;
  onAnalyze: () => void;
  projectId: string;
}

export function FixAnalysisPanel({ loading, error, fix, onAnalyze, projectId }: Props) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-slate-200">AI 修复分析</h3>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
        >
          {loading ? "分析中…" : "开始分析"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {fix && (
        <>
          {fix.failingTests.length > 0 && (
            <div>
              <h4 className="text-sm text-slate-400 mb-2">失败用例</h4>
              <ul className="space-y-2 text-sm">
                {fix.failingTests.map((t) => (
                  <li key={t.nodeId} className="rounded bg-slate-800/80 p-2 font-mono">
                    <div className="text-red-300">{t.tc}</div>
                    <div className="text-slate-500 text-xs mt-1">{t.error}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fix.tracePaths.length > 0 && (
            <div>
              <h4 className="text-sm text-slate-400 mb-2">Trace 文件</h4>
              <ul className="text-sm space-y-1">
                {fix.tracePaths.map((p) => (
                  <li key={p}>
                    <a
                      className="text-emerald-400 hover:underline font-mono text-xs"
                      href={`/api/projects/${projectId}/runs/${fix.runId}/traces?path=${encodeURIComponent(p)}`}
                    >
                      {p}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{fix.analysis}</ReactMarkdown>
          </div>
        </>
      )}
    </div>
  );
}
