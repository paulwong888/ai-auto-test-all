import { parseGherkinText } from "../lib/gherkin";
import {
  phaseClass,
  phaseLabel,
  specArtifactKey,
  type Journey,
} from "../types";

interface Props {
  journey: Journey;
  specAvailable: boolean;
  onViewSpec?: (artifactKey: string) => void;
}

const priorityClass: Record<string, string> = {
  P1: "priority-p1",
  P2: "priority-p2",
  P3: "priority-p3",
  P4: "priority-p4",
};

export function JourneyCard({ journey, specAvailable, onViewSpec }: Props) {
  const { scenario, steps } = parseGherkinText(journey.gherkinText);

  return (
    <article className="journey-card">
      <header className="journey-card-header">
        <div>
          <div className="journey-card-title-row">
            <h3>{journey.name}</h3>
            {journey.priority && (
              <span className={`priority-badge ${priorityClass[journey.priority] ?? ""}`}>
                {journey.priority}
              </span>
            )}
            {journey.category && (
              <span className="category-badge">{journey.category}</span>
            )}
          </div>
          {scenario && <p className="journey-scenario">{scenario}</p>}
          {journey.description && (
            <p className="journey-desc">{journey.description}</p>
          )}
        </div>
        {specAvailable && onViewSpec && (
          <button
            type="button"
            className="journey-spec-btn"
            onClick={() => onViewSpec(specArtifactKey(journey.id))}
          >
            查看 Spec
          </button>
        )}
      </header>

      <ul className="gherkin-steps">
        {steps
          .filter((s) => s.phase !== "scenario")
          .map((s, i) => (
            <li key={`${s.phase}-${i}`} className={phaseClass[s.phase]}>
              <span className="gherkin-phase">{phaseLabel[s.phase]}</span>
              <span className="gherkin-text">{s.text}</span>
            </li>
          ))}
      </ul>

      {journey.steps.length > 0 && (
        <details className="journey-steps-detail">
          <summary>POM 步骤 ({journey.steps.length})</summary>
          <ol className="pom-steps">
            {journey.steps.map((s) => (
              <li key={s.step}>
                <span className="mono">{s.pom}.{s.method}()</span>
                {s.description && (
                  <span className="muted"> — {s.description}</span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      {journey.expectedOutcome && (
        <p className="journey-outcome">
          <strong>预期：</strong>
          {journey.expectedOutcome}
        </p>
      )}
    </article>
  );
}

interface JourneysPanelProps {
  doc: import("../types").JourneysDocument;
  availableSpecKeys: Set<string>;
  onViewSpec?: (artifactKey: string) => void;
}

export function JourneysPanel({
  doc,
  availableSpecKeys,
  onViewSpec,
}: JourneysPanelProps) {
  return (
    <div className="journeys-panel">
      <div className="journeys-summary">
        <span>旅程 {doc.summary?.journeyCount ?? doc.journeys.length} 条</span>
        {doc.targetUrl && (
          <span className="mono muted">target: {doc.targetUrl}</span>
        )}
        {doc.summary?.componentsCovered?.length ? (
          <span>覆盖组件 {doc.summary.componentsCovered.length}</span>
        ) : null}
      </div>
      <div className="journey-cards">
        {doc.journeys.map((j) => (
          <JourneyCard
            key={j.id}
            journey={j}
            specAvailable={availableSpecKeys.has(specArtifactKey(j.id))}
            onViewSpec={onViewSpec}
          />
        ))}
      </div>
    </div>
  );
}
