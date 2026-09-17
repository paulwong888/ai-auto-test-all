import type { Journey } from "../types";
import { JourneyStepsEditor } from "./JourneyStepsEditor";

const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

const CATEGORIES = [
  "Happy Path",
  "Permission Boundary",
  "Feature Flag Toggle",
  "Error Handling",
  "Data Boundary",
  "Cross-Page",
] as const;

interface Props {
  journey: Journey;
  poms: string[];
  methods: Record<string, string[]>;
  onChange: (journey: Journey) => void;
  onRemove: () => void;
}

export function JourneyForm({
  journey,
  poms,
  methods,
  onChange,
  onRemove,
}: Props) {
  function patch(partial: Partial<Journey>) {
    onChange({ ...journey, ...partial });
  }

  return (
    <article className="journey-card journey-form">
      <header className="journey-card-header">
        <h3>编辑 Journey</h3>
        <button type="button" className="btn-secondary" onClick={onRemove}>
          删除旅程
        </button>
      </header>

      <div className="journey-form-grid">
        <label>
          ID
          <input
            type="text"
            className="mono"
            value={journey.id}
            onChange={(e) => patch({ id: e.target.value })}
          />
        </label>
        <label>
          名称
          <input
            type="text"
            value={journey.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label>
          优先级
          <select
            value={journey.priority ?? ""}
            onChange={(e) =>
              patch({
                priority: e.target.value
                  ? (e.target.value as Journey["priority"])
                  : undefined,
              })
            }
          >
            <option value="">—</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          分类
          <select
            value={journey.category ?? ""}
            onChange={(e) =>
              patch({
                category: e.target.value || undefined,
              })
            }
          >
            <option value="">—</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="journey-form-field">
        描述
        <textarea
          rows={2}
          value={journey.description ?? ""}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </label>

      <label className="journey-form-field">
        Gherkin
        <textarea
          rows={6}
          className="mono"
          value={journey.gherkinText}
          onChange={(e) => patch({ gherkinText: e.target.value })}
        />
      </label>

      <label className="journey-form-field">
        预期结果
        <input
          type="text"
          value={journey.expectedOutcome ?? ""}
          onChange={(e) => patch({ expectedOutcome: e.target.value })}
        />
      </label>

      <details open className="journey-steps-detail">
        <summary>POM 步骤</summary>
        <JourneyStepsEditor
          steps={journey.steps}
          poms={poms}
          methods={methods}
          onChange={(steps) => patch({ steps })}
        />
      </details>
    </article>
  );
}
