import { useEffect, useRef } from "react";

interface Props {
  logs: string[];
  running: boolean;
}

export function LiveTerminal({ logs, running }: Props) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    // Scroll inside the log panel only — scrollIntoView would drag the whole page down.
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="rounded-lg border border-slate-700 bg-black/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 flex items-center gap-2 text-xs text-slate-400">
        <span
          className={`h-2 w-2 rounded-full ${running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`}
        />
        {running ? "运行中…" : "终端输出"}
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
