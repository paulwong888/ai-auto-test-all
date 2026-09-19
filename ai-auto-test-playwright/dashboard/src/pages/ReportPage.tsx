import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchJson } from "../api/client.js";
import { FixAnalysisPanel } from "../components/FixAnalysisPanel.js";
import { useJobPoll } from "../hooks/useJobPoll.js";
import type { FixSuggestion, RunRecord } from "../types/project.js";

export function ReportPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const { pollJob } = useJobPoll();
  const [run, setRun] = useState<RunRecord | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [fix, setFix] = useState<FixSuggestion | null>(null);

  useEffect(() => {
    if (!id || !runId) return;
    void fetchJson<RunRecord>(`/api/projects/${id}/runs/${runId}`)
      .then(setRun)
      .catch(() => setRun(null));
    void fetchJson<FixSuggestion>(`/api/projects/${id}/runs/${runId}/fix`)
      .then(setFix)
      .catch(() => setFix(null));
  }, [id, runId]);

  const analyzeFix = async () => {
    if (!id || !runId) return;
    setFixLoading(true);
    setFixError(null);
    try {
      const { jobId } = await fetchJson<{ jobId: string }>(`/api/projects/${id}/fix/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const job = await pollJob(jobId);
      if (job.status === "failed") throw new Error(job.error ?? "分析失败");
      const data = await fetchJson<FixSuggestion>(`/api/projects/${id}/runs/${runId}/fix`);
      setFix(data);
    } catch (err) {
      setFixError(err instanceof Error ? err.message : "分析失败");
    } finally {
      setFixLoading(false);
    }
  };

  const showFix = run && (run.status === "failed" || run.failed > 0);

  return (
    <div className="space-y-4 -mx-6 -my-4 flex flex-col min-h-[calc(100vh-8rem)]">
      <div className="px-6 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
        <div>
          <Link to={`/projects/${id}/run`} className="text-sm text-emerald-400 hover:underline">
            ← 返回执行
          </Link>
          <h1 className="font-medium mt-1">测试报告</h1>
          {run && (
            <p className="text-xs text-slate-500 font-mono">
              {runId} · {run.passed}P / {run.failed}F
            </p>
          )}
        </div>
      </div>

      <iframe
        title="pytest report"
        src={`/api/projects/${id}/runs/${runId}/report`}
        className="flex-1 w-full min-h-[480px] bg-white"
      />

      {showFix && id && runId && (
        <div className="px-6 pb-2">
          <Link to={`/projects/${id}/fix/${runId}`} className="text-sm text-amber-400 hover:underline">
            打开修复审查 →
          </Link>
        </div>
      )}

      {showFix && id && runId && (
        <div className="px-6 pb-6">
          <FixAnalysisPanel
            loading={fixLoading}
            error={fixError}
            fix={fix}
            onAnalyze={() => void analyzeFix()}
            projectId={id}
          />
        </div>
      )}
    </div>
  );
}
