import type { FeatureItem, FlatGherkinStep, GherkinPhase } from "../types";
import { phaseLabel, statusIcon, stepKey } from "../types";

interface Props {
  feature: FeatureItem;
  liveSteps: FlatGherkinStep[] | null;
  isActive: boolean;
  isRunning: boolean;
  onRun: (featureId: string) => void;
}

function stepsForFeature(
  feature: FeatureItem,
  liveSteps: FlatGherkinStep[] | null,
  isActive: boolean,
): { phase: GherkinPhase; index: number; text: string; status: FlatGherkinStep["status"] }[] {
  const base: FlatGherkinStep[] = [];
  const push = (phase: GherkinPhase, texts: string[]) => {
    texts.forEach((text, index) => base.push({ phase, index, text, status: "pending" }));
  };
  push("given", feature.gherkin.given);
  push("when", feature.gherkin.when);
  if (feature.gherkin.and?.length) push("and", feature.gherkin.and);
  push("then", feature.gherkin.then);

  if (!isActive || !liveSteps) return base;

  return base.map((s) => {
    const live = liveSteps.find((l) => l.phase === s.phase && l.index === s.index);
    return live ? { ...s, status: live.status } : s;
  });
}

export default function FeatureCard({
  feature,
  liveSteps,
  isActive,
  isRunning,
  onRun,
}: Props) {
  const steps = stepsForFeature(feature, liveSteps, isActive);

  return (
    <article
      className={`rounded-xl border p-4 space-y-3 transition-colors ${
        isActive
          ? "border-emerald-600/60 bg-emerald-950/20"
          : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-100">{feature.title}</h3>
          <p className="text-xs text-slate-500 mt-1">{feature.gherkin.scenario}</p>
        </div>
        <button
          type="button"
          disabled={isRunning}
          onClick={() => onRun(feature.id)}
          className="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-medium whitespace-nowrap"
        >
          驅動 AI 執行
        </button>
      </div>

      <ul className="space-y-1.5 text-sm">
        {steps.map((s) => (
          <li
            key={stepKey(s.phase, s.index)}
            className={`flex gap-2 rounded px-2 py-1 ${
              s.status === "running" || s.status === "healing"
                ? "bg-emerald-900/30"
                : s.status === "fail"
                  ? "bg-red-950/40"
                  : ""
            }`}
          >
            <span className="w-5 shrink-0 text-center">{statusIcon(s.status)}</span>
            <span className="text-slate-500 w-8 shrink-0">{phaseLabel[s.phase]}</span>
            <span className="text-slate-300">{s.text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
