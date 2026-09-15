import { useEffect, useState } from "react";

export interface RunHistoryRecord {
  id: string;
  project_id: string;
  status: string;
  current_agent: string | null;
  started_at: string;
  finished_at: string | null;
  execution_mode?: string | null;
  execution_status?: string | null;
}

interface Props {
  projectId: string;
  activeRunId: string | null;
  onSelect: (runId: string) => void;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function RunHistoryPanel({ projectId, activeRunId, onSelect }: Props) {
  const [runs, setRuns] = useState<RunHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRuns([]);
      return;
    }
    setLoading(true);
    fetch(`/api/pipeline/runs?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => setRuns((data.runs ?? []) as RunHistoryRecord[]))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [projectId, activeRunId]);

  if (!projectId) return null;

  return (
    <section className="panel run-history">
      <h2>历史 Run</h2>
      {loading && <p className="hint">加载中…</p>}
      {!loading && runs.length === 0 && (
        <p className="hint">暂无历史记录</p>
      )}
      <ul className="run-history-list">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              className={[
                "run-history-item",
                activeRunId === run.id ? "active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelect(run.id)}
            >
              <span className="mono">{run.id.slice(0, 8)}…</span>
              <span className={`badge badge-${run.status}`}>{run.status}</span>
              {run.execution_status && (
                <span className="badge badge-muted">exec: {run.execution_status}</span>
              )}
              <span className="muted">{formatTime(run.started_at)}</span>
              {run.current_agent && (
                <span className="muted">{run.current_agent}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
