export type GherkinPhase = "scenario" | "given" | "when" | "then" | "and";

export interface ParsedGherkinStep {
  phase: GherkinPhase;
  text: string;
}

export type JourneyAction =
  | "navigate"
  | "assert_visible"
  | "interact"
  | "assert_state";

export interface JourneyStep {
  step: number;
  action: JourneyAction;
  pom: string;
  method: string;
  description?: string;
}

export interface Journey {
  id: string;
  name: string;
  description?: string;
  priority?: string;
  category?: string;
  gherkinText: string;
  steps: JourneyStep[];
  expectedOutcome?: string;
}

export interface JourneysDocument {
  version: string;
  generatedAt: string;
  targetUrl?: string;
  journeys: Journey[];
  summary?: {
    journeyCount: number;
    componentsCovered: string[];
  };
}

export interface ComponentRegistryPreview {
  version?: string;
  scannedAt?: string;
  frontendPath?: string;
  scanStats?: {
    filesScanned: number;
    componentsFound: number;
    parseErrors: number;
  };
  components: Array<{
    name: string;
    filePath: string;
    businessSemantics?: string;
    interactiveElements?: unknown[];
  }>;
}

export interface InjectionsPreview {
  dryRun?: boolean;
  generatedAt?: string;
  patches: Array<{
    file: string;
    line: number;
    component: string;
    elementRole: string;
    testId: string;
    action: string;
  }>;
}

export interface ExecutionReportPreview {
  version?: string;
  generatedAt?: string;
  executionMode?: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky?: number;
  };
  results: Array<{
    journeyId: string;
    title: string;
    status: string;
    failureType?: string;
    attempts: number;
    error?: string;
    durationMs?: number;
    executionMode?: string;
  }>;
}

export interface LocatorsPreview {
  generatedAt?: string;
  locators: Array<{
    component: string;
    element: string;
    testId?: string;
    priority: string[];
  }>;
}

export const phaseLabel: Record<GherkinPhase, string> = {
  scenario: "场景",
  given: "Given",
  when: "When",
  then: "Then",
  and: "And",
};

export const phaseClass: Record<GherkinPhase, string> = {
  scenario: "gherkin-scenario",
  given: "gherkin-given",
  when: "gherkin-when",
  then: "gherkin-then",
  and: "gherkin-and",
};

export function specArtifactKey(journeyId: string): string {
  const fileName = `${journeyId.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-")}.spec.ts`;
  return `spec-${fileName}`;
}
