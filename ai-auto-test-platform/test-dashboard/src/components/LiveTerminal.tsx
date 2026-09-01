import { useEffect, useMemo, useRef } from "react";
import type { LiveLogLine } from "../hooks/useRunWebSocket";
import type { FlatGherkinStep, RunMilestone } from "../types";
import { phaseLabel, statusIcon } from "../types";
import HealingTimeline from "./HealingTimeline";
import MarkdownReport from "./MarkdownReport";
import ThenAssertionPanel from "./ThenAssertionPanel";

interface Props {
  connected: boolean;
  title: string;
  steps: FlatGherkinStep[];
  logs: LiveLogLine[];
  milestones: RunMilestone[];
  finished: { success: boolean; message: string } | null;
  testReport: string | null;
}

const streamColor: Record<LiveLogLine["stream"], string> = {
  stdout: "text-green-400",
  stderr: "text-red-400",
  ai: "text-cyan-400/90",
  tool: "text-yellow-400/90",
};

export default function LiveTerminal({
  connected,
  title,
  steps,
  logs,
  milestones,
  finished,
  testReport,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const showReport = Boolean(finished?.success && testReport);
  const hasThenSteps = steps.some((s) => s.phase === "then");

  const displayLogs = useMemo(() => {
    if (!showReport) return logs;
    return logs.filter((line) => line.stream !== "ai");
  }, [logs, showReport]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayLogs, steps, testReport, milestones]);

  return (
    <div className="flex flex-col h-full min-h-[420px] rounded-xl border border-slate-800 overflow-hidden bg-black">
      <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-950">
        <span className="text-sm text-green-500 font-mono">
          {title ? `LIVE // ${title}` : "測試直播間"}
        </span>
        <span className={`text-xs ${connected ? "text-green-600" : "text-red-500"}`}>
          {connected ? "WS 已連線" : "WS 斷開"}
        </span>
      </div>

      {steps.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-900 text-xs font-mono space-y-0.5 max-h-32 overflow-y-auto">
          {steps.map((s) => (
            <div
              key={`${s.phase}:${s.index}`}
              className={`text-slate-400 ${s.status === "healing" ? "text-amber-300" : ""}`}
            >
              {statusIcon(s.status)} [{phaseLabel[s.phase]}] {s.text}
            </div>
          ))}
        </div>
      )}

      <HealingTimeline milestones={milestones} />

      {(hasThenSteps && (milestones.length > 0 || finished)) && (
        <ThenAssertionPanel steps={steps} milestones={milestones} />
      )}

      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed min-h-0">
        {displayLogs.length === 0 && !showReport && (
          <p className="text-slate-600">等待執行… 點擊左側「驅動 AI 執行」開始</p>
        )}
        {displayLogs.map((line) => (
          <div key={line.id} className={`whitespace-pre-wrap break-all ${streamColor[line.stream]}`}>
            {line.text}
          </div>
        ))}
        {finished && !showReport && (
          <div className={`mt-2 ${finished.success ? "text-green-400" : "text-red-400"}`}>
            {"\n"}═══ {finished.message} ═══
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showReport && testReport && <MarkdownReport content={testReport} />}
    </div>
  );
}
