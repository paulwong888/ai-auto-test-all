import type { FlatGherkinStep, RunMilestone } from "../types";
import { phaseLabel, statusIcon } from "../types";

interface Props {
  steps: FlatGherkinStep[];
  milestones: RunMilestone[];
}

export default function ThenAssertionPanel({ steps, milestones }: Props) {
  const thenSteps = steps.filter((s) => s.phase === "then");
  if (thenSteps.length === 0) return null;

  const thenMilestones = milestones.filter((m) => m.kind === "then_pass" || m.kind === "then_fail");

  return (
    <div className="border-t border-slate-800 bg-slate-950/90 px-4 py-3">
      <h3 className="text-xs font-medium text-emerald-400 mb-2">Then 斷言結果</h3>
      <ul className="space-y-1.5 text-xs">
        {thenSteps.map((s) => {
          const hit = thenMilestones.find((m) => m.index === s.index);
          return (
            <li
              key={`then:${s.index}`}
              className={`flex gap-2 rounded px-2 py-1.5 ${
                s.status === "pass"
                  ? "bg-emerald-950/40 border border-emerald-900/50"
                  : s.status === "fail"
                    ? "bg-red-950/40 border border-red-900/50"
                    : s.status === "running"
                      ? "bg-amber-950/30 border border-amber-900/40"
                      : "bg-slate-900/40 border border-slate-800"
              }`}
            >
              <span className="shrink-0">{statusIcon(s.status)}</span>
              <span className="text-slate-500 shrink-0">{phaseLabel.then}</span>
              <span className="text-slate-300 flex-1">{s.text}</span>
              {hit && (
                <span
                  className={`shrink-0 ${hit.kind === "then_pass" ? "text-emerald-400" : "text-red-400"}`}
                >
                  {hit.kind === "then_pass" ? "通過" : "失敗"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
