import type { GherkinPhase, ParsedGherkinStep } from "../types";

const STEP_PREFIX = /^\s*(Scenario|Given|When|Then|And)\s*:?\s+(.+)$/i;

function phaseFromKeyword(keyword: string): GherkinPhase {
  const k = keyword.toLowerCase();
  if (k === "scenario") return "scenario";
  if (k === "given") return "given";
  if (k === "when") return "when";
  if (k === "then") return "then";
  return "and";
}

export function parseGherkinText(text: string): {
  scenario: string;
  steps: ParsedGherkinStep[];
} {
  const lines = text.split("\n").map((l) => l.trimEnd());
  let scenario = "";
  const steps: ParsedGherkinStep[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(STEP_PREFIX);
    if (match) {
      const phase = phaseFromKeyword(match[1]!);
      const content = match[2]!.trim();
      if (phase === "scenario") {
        scenario = content;
      }
      steps.push({ phase, text: content });
      continue;
    }

    // Continuation line (indented without keyword)
    if (steps.length > 0 && /^\s/.test(line)) {
      const last = steps[steps.length - 1]!;
      last.text = `${last.text} ${trimmed}`.trim();
    }
  }

  return { scenario, steps };
}
