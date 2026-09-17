import type { JourneyStep } from "../types";

const ACTIONS = [
  "navigate",
  "assert_visible",
  "interact",
  "assert_state",
] as const;

interface Props {
  steps: JourneyStep[];
  poms: string[];
  methods: Record<string, string[]>;
  onChange: (steps: JourneyStep[]) => void;
}

export function JourneyStepsEditor({ steps, poms, methods, onChange }: Props) {
  function updateStep(index: number, patch: Partial<JourneyStep>) {
    const next = steps.map((s, i) =>
      i === index ? { ...s, ...patch } : s,
    );
    onChange(reindexSteps(next));
  }

  function addStep() {
    onChange(
      reindexSteps([
        ...steps,
        {
          step: steps.length + 1,
          action: "interact",
          pom: poms[0] ?? "",
          method: methods[poms[0] ?? ""]?.[0] ?? "",
          description: "",
        },
      ]),
    );
  }

  function removeStep(index: number) {
    onChange(reindexSteps(steps.filter((_, i) => i !== index)));
  }

  function moveStep(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(reindexSteps(next));
  }

  return (
    <div className="journey-steps-editor">
      <table className="artifact-table journey-steps-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Action</th>
            <th>POM</th>
            <th>Method</th>
            <th>Description</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const pomMethods = methods[s.pom] ?? [];
            return (
              <tr key={`step-${i}`}>
                <td>{s.step}</td>
                <td>
                  <select
                    value={s.action}
                    onChange={(e) =>
                      updateStep(i, {
                        action: e.target.value as JourneyStep["action"],
                      })
                    }
                  >
                    {ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={s.pom}
                    onChange={(e) => {
                      const pom = e.target.value;
                      const firstMethod = methods[pom]?.[0] ?? "";
                      updateStep(i, { pom, method: firstMethod });
                    }}
                  >
                    {poms.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={s.method}
                    onChange={(e) => updateStep(i, { method: e.target.value })}
                  >
                    {pomMethods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={s.description ?? ""}
                    onChange={(e) =>
                      updateStep(i, { description: e.target.value })
                    }
                    placeholder="可选说明"
                  />
                </td>
                <td className="journey-step-actions">
                  <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(i, 1)}
                    disabled={i === steps.length - 1}
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => removeStep(i)}>
                    删
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" onClick={addStep}>
        添加步骤
      </button>
    </div>
  );
}

function reindexSteps(steps: JourneyStep[]): JourneyStep[] {
  return steps.map((s, i) => ({ ...s, step: i + 1 }));
}
