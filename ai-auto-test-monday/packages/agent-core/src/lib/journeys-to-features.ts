import type { JourneysDocument } from "../artifacts/types.js";

export interface FeatureGherkin {
  scenario: string;
  given: string[];
  when: string[];
  then: string[];
  and?: string[];
}

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
  sourceFile: string;
  route?: string;
  gherkin: FeatureGherkin;
  gherkinText: string;
}

export interface FeaturesDocument {
  version: "1.0";
  generatedAt: string;
  repoPath: string;
  features: FeatureItem[];
}

function parseGherkinText(text: string): FeatureGherkin {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let scenario = "Scenario";
  const given: string[] = [];
  const when: string[] = [];
  const then: string[] = [];
  const and: string[] = [];

  for (const line of lines) {
    if (line.startsWith("Scenario:")) {
      scenario = line.slice("Scenario:".length).trim();
      continue;
    }
    const lower = line.toLowerCase();
    const content = line.replace(/^(Given|When|Then|And)\s+/i, "").trim();
    if (lower.startsWith("given ")) given.push(content);
    else if (lower.startsWith("when ")) when.push(content);
    else if (lower.startsWith("then ")) then.push(content);
    else if (lower.startsWith("and ")) and.push(content);
  }

  if (given.length === 0) given.push("the user opens the application");
  if (when.length === 0) when.push("the user interacts with the page");
  if (then.length === 0) then.push("the expected outcome is observed");

  return {
    scenario,
    given,
    when,
    then,
    ...(and.length > 0 ? { and } : {}),
  };
}

export function journeysToFeatures(
  doc: JourneysDocument,
  repoPath: string,
  defaultSourceFile = "src/App.tsx",
): FeaturesDocument {
  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    repoPath,
    features: doc.journeys.map((j) => ({
      id: j.id,
      title: j.name,
      description: j.description ?? j.name,
      sourceFile: defaultSourceFile,
      gherkin: parseGherkinText(j.gherkinText),
      gherkinText: j.gherkinText,
    })),
  };
}
