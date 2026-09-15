export const JOURNEY_CATEGORIES = [
  "Happy Path",
  "Permission Boundary",
  "Feature Flag Toggle",
  "Error Handling",
  "Data Boundary",
  "Cross-Page",
] as const;

export type JourneyCategory = (typeof JOURNEY_CATEGORIES)[number];

const EXACT = new Set<string>(JOURNEY_CATEGORIES);

const ALIASES: Record<string, JourneyCategory> = {
  authentication: "Happy Path",
  auth: "Happy Path",
  login: "Happy Path",
  "happy-path": "Happy Path",
  happypath: "Happy Path",
  navigation: "Cross-Page",
  routing: "Cross-Page",
  "cross-page": "Cross-Page",
  crosspage: "Cross-Page",
  error: "Error Handling",
  failure: "Error Handling",
  "error-handling": "Error Handling",
  permission: "Permission Boundary",
  rbac: "Permission Boundary",
  "permission-boundary": "Permission Boundary",
  "feature-flag": "Feature Flag Toggle",
  "feature-flag-toggle": "Feature Flag Toggle",
  toggle: "Feature Flag Toggle",
  data: "Data Boundary",
  "data-boundary": "Data Boundary",
};

export function normalizeJourneyCategory(raw: unknown): JourneyCategory | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw !== "string") {
    console.warn("[journey-category] non-string category, defaulting to Happy Path:", raw);
    return "Happy Path";
  }

  const trimmed = raw.trim();
  if (EXACT.has(trimmed)) {
    return trimmed as JourneyCategory;
  }

  const mapped = ALIASES[trimmed.toLowerCase()];
  if (mapped) {
    console.warn(
      `[journey-category] mapped category "${trimmed}" → "${mapped}"`,
    );
    return mapped;
  }

  console.warn(
    `[journey-category] unknown category "${trimmed}", defaulting to Happy Path`,
  );
  return "Happy Path";
}
