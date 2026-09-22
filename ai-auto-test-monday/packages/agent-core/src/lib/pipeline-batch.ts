import type {
  ComponentRegistry,
  Journey,
  JourneyStep,
} from "../artifacts/types.js";

export function chunk<T>(items: T[], size: number): T[][] {
  const batchSize = Math.max(1, size);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

export function componentsWithElements(
  registry: ComponentRegistry,
): ComponentRegistry["components"] {
  return registry.components.filter((c) => {
    if (c.excludeFromPom) return false;
    if (c.interactiveElements.length > 0) return true;
    const normalized = c.filePath.replace(/\\/g, "/");
    const isPage =
      normalized.includes("/pages/") ||
      normalized.startsWith("pages/") ||
      c.name.endsWith("Page");
    return isPage && (c.pageKind === "read-only" || c.pageKind === "interactive" || !c.pageKind);
  });
}

export function componentNameFromPomClass(pomClass: string): string {
  return pomClass.replace(/Page$/, "");
}

export function componentNameFromPomFile(fileName: string): string {
  const base = fileName.replace(/\.ts$/i, "");
  return componentNameFromPomClass(base);
}

export function pomClassFromComponentName(componentName: string): string {
  return `${componentName}Page`;
}

function slugifyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function pomsUsedByJourneys(journeys: Journey[]): Set<string> {
  const used = new Set<string>();
  for (const journey of journeys) {
    for (const step of journey.steps) {
      used.add(step.pom);
    }
  }
  return used;
}

function buildMinimalJourney(pom: string, targetUrl?: string): Journey {
  const component = componentNameFromPomClass(pom);
  const slug = slugifyId(component) || "journey";
  const url = targetUrl ?? "/";
  const steps: JourneyStep[] = [
    {
      step: 1,
      action: "navigate",
      pom,
      method: "navigateTo",
      args: [url],
      description: `Open ${component}`,
    },
    {
      step: 2,
      action: "assert_visible",
      pom,
      method: "waitForReady",
      description: `Wait for ${component} to be ready`,
    },
  ];

  return {
    id: `${slug}-happy-path`,
    name: `${component} happy path`,
    description: `Minimal happy path for ${component}`,
    priority: "P2",
    category: "Happy Path",
    gherkinText: [
      `Scenario: ${component} loads successfully`,
      "Given the user opens the application",
      `When the user navigates to ${component}`,
      `Then ${component} is ready`,
    ].join("\n"),
    steps,
    expectedOutcome: `${component} page loads and is ready`,
  };
}

/** Append deterministic journeys for POMs not referenced in any step. */
export function ensurePomCoverage(
  journeys: Journey[],
  availablePoms: string[],
  targetUrl?: string,
): Journey[] {
  const merged = [...journeys];
  const used = pomsUsedByJourneys(merged);
  const seenIds = new Set(merged.map((j) => j.id));

  for (const pom of availablePoms) {
    if (used.has(pom)) continue;
    let fallback = buildMinimalJourney(pom, targetUrl);
    if (seenIds.has(fallback.id)) {
      fallback = {
        ...fallback,
        id: `${fallback.id}-fallback`,
      };
    }
    merged.push(fallback);
    seenIds.add(fallback.id);
    used.add(pom);
  }

  return merged;
}

export function dedupeJourneysById(journeys: Journey[]): Journey[] {
  const seen = new Set<string>();
  const out: Journey[] = [];
  for (const journey of journeys) {
    if (seen.has(journey.id)) continue;
    seen.add(journey.id);
    out.push(journey);
  }
  return out;
}
