import type { ComponentRegistry, Journey, JourneysDocument } from "../artifacts/types.js";
import { journeysDocumentSchema } from "../artifacts/types.js";
import { normalizeJourneysForExecution } from "./journey-normalize.js";
import { parsePomMethods, pomFileNameToClassName } from "./pom-utils.js";

export function filterValidJourneys(
  journeys: Journey[],
  allowedPoms: Set<string>,
): Journey[] {
  return journeys.filter(
    (j) =>
      j.gherkinText?.trim() &&
      j.steps.length > 0 &&
      j.steps.every((s) => allowedPoms.has(s.pom)),
  );
}

export function pomClassNamesFromKeys(pomKeys: string[]): string[] {
  return pomKeys.map((k) => {
    const base = k.replace(/^poms\//, "").replace(/\.ts$/, "");
    return pomFileNameToClassName(`${base}.ts`);
  });
}

export function buildPomMethodMap(
  pomEntries: Array<{ className: string; content: string }>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { className, content } of pomEntries) {
    out[className] = [...parsePomMethods(content)];
  }
  return out;
}

export function findJourneyValidationErrors(
  doc: JourneysDocument,
  allowedPoms: Set<string>,
  pomMethods: Record<string, string[]>,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const j of doc.journeys) {
    if (ids.has(j.id)) errors.push(`Duplicate journey id: ${j.id}`);
    ids.add(j.id);
    if (!j.gherkinText?.trim()) errors.push(`Journey ${j.id}: empty gherkinText`);
    if (j.steps.length === 0) errors.push(`Journey ${j.id}: no steps`);
    for (const step of j.steps) {
      if (!allowedPoms.has(step.pom)) {
        errors.push(`Journey ${j.id}: unknown pom ${step.pom}`);
        continue;
      }
      const methods = pomMethods[step.pom];
      if (!methods?.includes(step.method)) {
        errors.push(`Journey ${j.id}: unknown method ${step.pom}.${step.method}`);
      }
    }
  }
  return errors;
}

export function parseAndNormalizeJourneysDocument(
  raw: unknown,
  options: {
    registry: ComponentRegistry;
    targetUrl?: string;
    allowedPoms: Set<string>;
  },
): JourneysDocument {
  const parsed = journeysDocumentSchema.parse(raw);
  const valid = filterValidJourneys(parsed.journeys, options.allowedPoms);
  if (valid.length !== parsed.journeys.length) {
    throw new Error("One or more journeys reference invalid or empty steps");
  }
  const normalized = normalizeJourneysForExecution(valid, {
    registry: options.registry,
    targetUrl: options.targetUrl,
  });
  return {
    ...parsed,
    journeys: normalized,
    summary: {
      journeyCount: normalized.length,
      componentsCovered: [
        ...new Set(normalized.flatMap((j) => j.steps.map((s) => s.pom))),
      ],
    },
  };
}
