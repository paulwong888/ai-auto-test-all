import type { RunMilestone } from "../types";

interface Props {
  milestones: RunMilestone[];
}

const kindStyle: Record<RunMilestone["kind"], string> = {
  when_failed: "border-red-800/60 bg-red-950/30 text-red-200",
  healing_start: "border-amber-800/60 bg-amber-950/30 text-amber-200",
  healing_edit: "border-amber-800/40 bg-amber-950/20 text-amber-100",
  healing_retry: "border-cyan-800/60 bg-cyan-950/30 text-cyan-200",
  then_checking: "border-emerald-800/40 bg-emerald-950/20 text-emerald-200",
  then_pass: "border-emerald-800/60 bg-emerald-950/30 text-emerald-200",
  then_fail: "border-red-800/60 bg-red-950/30 text-red-200",
};

export default function HealingTimeline({ milestones }: Props) {
  const flow = milestones.filter((m) =>
    ["when_failed", "healing_start", "healing_edit", "healing_retry", "then_checking"].includes(
      m.kind,
    ),
  );

  if (flow.length === 0) return null;

  return (
    <div className="border-b border-slate-900 px-4 py-2 space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">自愈流程</p>
      {flow.map((m) => (
        <div
          key={m.id}
          className={`text-xs rounded px-2.5 py-1.5 border ${kindStyle[m.kind]}`}
        >
          {m.message}
        </div>
      ))}
    </div>
  );
}
