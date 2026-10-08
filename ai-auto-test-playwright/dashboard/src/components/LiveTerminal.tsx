import { useEffect, useRef, useState } from "react";

interface Props {
  logs: string[];
  running: boolean;
  pulseAt?: number | null;
  runStartedAt?: number | null;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function LiveTerminal({ logs, running, pulseAt, runStartedAt }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const elapsedMs = running && runStartedAt ? now - runStartedAt : 0;
  const silentMs = running && pulseAt ? now - pulseAt : 0;
  const showSilentHint = running && silentMs > 45_000;

  return (
    <div className="rounded-lg border border-slate-700 bg-black/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 flex items-center gap-2 text-xs text-slate-400 flex-wrap">
        <span
          className={`h-2 w-2 rounded-full ${running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`}
        />
        {running ? (
          <>
            <span>运行中…</span>
            {runStartedAt ? (
              <span className="text-slate-500">已运行 {formatElapsed(elapsedMs)}</span>
            ) : null}
            {showSilentHint ? (
              <span className="text-amber-400/90">pytest 执行中，暂无新日志（连接正常）</span>
            ) : null}
          </>
        ) : (
          <span>终端输出</span>
        )}
      </div>
      <pre
        ref={preRef}
        className="p-4 text-xs font-mono text-emerald-200/90 max-h-96 overflow-auto whitespace-pre-wrap break-all"
      >
        {logs.length === 0 ? "等待日志…" : logs.join("\n")}
      </pre>
    </div>
  );
}
