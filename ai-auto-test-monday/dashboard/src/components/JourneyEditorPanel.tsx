import { useCallback, useEffect, useState } from "react";
import type { Journey, JourneysDocument } from "../types";
import { JourneyForm } from "./JourneyForm";

interface PomCatalog {
  poms: string[];
  methods: Record<string, string[]>;
}

interface Props {
  runId: string;
  initialDoc: JourneysDocument;
  onCancel: () => void;
  onSaved: (doc: JourneysDocument) => void;
  onResumeFromAssistantDirector: () => void;
}

function newJourneyId(existing: Journey[]): string {
  let n = existing.length + 1;
  let id = `journey-${n}`;
  const ids = new Set(existing.map((j) => j.id));
  while (ids.has(id)) {
    n += 1;
    id = `journey-${n}`;
  }
  return id;
}

export function JourneyEditorPanel({
  runId,
  initialDoc,
  onCancel,
  onSaved,
  onResumeFromAssistantDirector,
}: Props) {
  const [doc, setDoc] = useState<JourneysDocument>(() =>
    structuredClone(initialDoc),
  );
  const [catalog, setCatalog] = useState<PomCatalog | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCatalog(true);
      try {
        const res = await fetch(`/api/pipeline/runs/${runId}/pom-catalog`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "Failed to load pom catalog");
        if (!cancelled) setCatalog({ poms: data.poms, methods: data.methods });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const poms = catalog?.poms ?? [];
  const methods = catalog?.methods ?? {};

  const updateJourney = useCallback((index: number, journey: Journey) => {
    setDoc((prev) => {
      const journeys = [...prev.journeys];
      journeys[index] = journey;
      return { ...prev, journeys };
    });
    setSaveSuccess(false);
  }, []);

  function addJourney() {
    const id = newJourneyId(doc.journeys);
    const journey: Journey = {
      id,
      name: `New journey ${doc.journeys.length + 1}`,
      gherkinText: `Scenario: ${id}\n  Given the user is on the app\n  When they perform an action\n  Then they see the expected result`,
      steps: poms.length
        ? [
            {
              step: 1,
              action: "interact",
              pom: poms[0],
              method: methods[poms[0]]?.[0] ?? "",
            },
          ]
        : [],
    };
    setDoc((prev) => ({
      ...prev,
      journeys: [...prev.journeys, journey],
    }));
    setSelectedIndex(doc.journeys.length);
    setSaveSuccess(false);
  }

  function removeJourney(index: number) {
    setDoc((prev) => ({
      ...prev,
      journeys: prev.journeys.filter((_, i) => i !== index),
    }));
    setSelectedIndex((i) => Math.max(0, Math.min(i, doc.journeys.length - 2)));
    setSaveSuccess(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      const payload: JourneysDocument = {
        ...doc,
        generatedAt: doc.generatedAt || new Date().toISOString(),
        summary: {
          journeyCount: doc.journeys.length,
          componentsCovered: [
            ...new Set(doc.journeys.flatMap((j) => j.steps.map((s) => s.pom))),
          ],
        },
      };
      const res = await fetch(
        `/api/pipeline/runs/${runId}/artifacts/journeys`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Save failed");
      setSaveSuccess(true);
      onSaved(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const selected = doc.journeys[selectedIndex];

  return (
    <div className="journey-editor-panel artifact-structured">
      <div className="journey-editor-toolbar">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          取消编辑
        </button>
        <button type="button" className="btn-secondary" onClick={addJourney} disabled={!poms.length}>
          新增旅程
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || loadingCatalog}>
          {saving ? "保存中…" : "保存 journeys"}
        </button>
      </div>

      {loadingCatalog && <p className="hint">加载 POM catalog…</p>}
      {!loadingCatalog && poms.length === 0 && (
        <p className="hint warn">尚无 POM 文件，无法编辑步骤。</p>
      )}
      {error && <p className="error">{error}</p>}
      {saveSuccess && (
        <div className="journey-save-success">
          <p className="hint">
            已保存。需从 Assistant Director 重新生成 Playwright spec。
          </p>
          <button type="button" onClick={onResumeFromAssistantDirector}>
            从 Assistant Director 重跑
          </button>
        </div>
      )}

      <div className="journey-editor-layout">
        <aside className="journey-editor-list">
          <h3>旅程列表 ({doc.journeys.length})</h3>
          <ul>
            {doc.journeys.map((j, i) => (
              <li key={j.id}>
                <button
                  type="button"
                  className={i === selectedIndex ? "active" : ""}
                  onClick={() => setSelectedIndex(i)}
                >
                  {j.name || j.id}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="journey-editor-main">
          {selected ? (
            <JourneyForm
              journey={selected}
              poms={poms}
              methods={methods}
              onChange={(j) => updateJourney(selectedIndex, j)}
              onRemove={() => removeJourney(selectedIndex)}
            />
          ) : (
            <p className="hint">暂无旅程，点击「新增旅程」。</p>
          )}
        </div>
      </div>
    </div>
  );
}
