import type { ComponentRegistry, JourneysDocument, Journey } from "../artifacts/types.js";
import {
  JOURNEY_CATEGORIES,
  journeyGenerationFromLlmSchema,
} from "../artifacts/types.js";
import {
  loadChoreographerLlmConfigFromEnv,
  loadJourneyConfigFromEnv,
} from "../config.js";
import { HigressClient } from "../llm/higress-client.js";

export interface ChoreographerInput {
  registry: ComponentRegistry;
  targetUrl?: string;
  availablePoms: string[];
}

function topComponents(registry: ComponentRegistry, limit = 12) {
  return registry.components
    .filter((c) => c.interactiveElements.length > 0)
    .slice(0, limit)
    .map((c) => ({
      name: c.name,
      businessSemantics: c.businessSemantics ?? "",
      elementCount: c.interactiveElements.length,
      featureFlags: c.featureFlags ?? [],
      elements: c.interactiveElements.slice(0, 6).map((e) => e.role),
    }));
}

function choreographerLlmError(message: string): Error {
  return new Error(`Choreographer: LLM journey generation failed — ${message}`);
}

async function generateWithLlm(
  registry: ComponentRegistry,
  targetUrl: string | undefined,
  availablePoms: string[],
  journeyMin: number,
  journeyMax: number,
): Promise<Journey[]> {
  const components = topComponents(registry);
  const llm = new HigressClient(loadChoreographerLlmConfigFromEnv());

  let result;
  try {
    result = await llm.chatJsonOrThrow(
      `You are Agent 5 Choreographer. Plan user test journeys for a React web app.
Return JSON { journeys: [...] } with ${journeyMin} to ${journeyMax} journeys.
Each journey MUST include: id (kebab-case), name, description, priority (P1-P4), category, gherkinText (full Gherkin Scenario with Given/When/Then), steps[].
category MUST be one of: ${JOURNEY_CATEGORIES.join(", ")}.
Each step: step (1-based), action (navigate|assert_visible|interact|assert_state), pom (MUST be from availablePoms), method (e.g. navigateTo, waitForReady, click{Component}Action, assert{Element}Visible), args (optional array), description.
Use only POM class names from availablePoms. Cover different top components across journeys.`,
      JSON.stringify({
        targetUrl: targetUrl ?? "",
        availablePoms,
        components,
      }),
      journeyGenerationFromLlmSchema,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw choreographerLlmError(reason);
  }

  if (!result?.journeys?.length) {
    throw choreographerLlmError(
      "LLM returned no journeys. Check LLM config and retry the pipeline.",
    );
  }

  const pomSet = new Set(availablePoms);
  const valid = result.journeys.filter(
    (j) =>
      j.gherkinText?.trim() &&
      j.steps.length > 0 &&
      j.steps.every((s) => pomSet.has(s.pom)),
  );

  if (valid.length < journeyMin) {
    throw choreographerLlmError(
      `LLM returned ${valid.length} valid journeys (need ${journeyMin}-${journeyMax}). Check LLM config and retry the pipeline.`,
    );
  }

  return valid.slice(0, journeyMax).map((j): Journey =>
    normalizeJourney({
      ...(j as Journey),
      category: j.category as Journey["category"],
    }),
  );
}

function normalizeJourney(j: Journey): Journey {
  return { ...j, priority: j.priority ?? "P1" };
}

function buildDocument(
  registry: ComponentRegistry,
  targetUrl: string | undefined,
  journeys: Journey[],
): JourneysDocument {
  const componentsCovered = [
    ...new Set(
      journeys.flatMap((j) => j.steps.map((s) => s.pom.replace(/Page$/, ""))),
    ),
  ].sort();

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    targetUrl,
    journeys,
    summary: {
      journeyCount: journeys.length,
      componentsCovered,
    },
  };
}

export async function runChoreographer(
  input: ChoreographerInput,
): Promise<JourneysDocument> {
  const { min: journeyMin, max: journeyMax } = loadJourneyConfigFromEnv();
  const availablePoms = input.availablePoms;

  if (availablePoms.length === 0) {
    throw new Error(
      "Choreographer: no POM classes found; run Set Designer first",
    );
  }

  const journeys = await generateWithLlm(
    input.registry,
    input.targetUrl,
    availablePoms,
    journeyMin,
    journeyMax,
  );

  return buildDocument(
    input.registry,
    input.targetUrl,
    journeys.map(normalizeJourney),
  );
}
