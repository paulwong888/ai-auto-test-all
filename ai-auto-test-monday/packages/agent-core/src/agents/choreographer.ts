import type {
  ComponentRegistry,
  JourneysDocument,
  Journey,
  JourneyStep,
} from "../artifacts/types.js";
import {
  JOURNEY_CATEGORIES,
  journeyGenerationFromLlmSchema,
} from "../artifacts/types.js";
import {
  loadChoreographerLlmConfigFromEnv,
  loadJourneyConfigFromEnv,
  loadPipelineScaleConfigFromEnv,
} from "../config.js";
import { HigressClient } from "../llm/higress-client.js";
import {
  chunk,
  componentNameFromPomClass,
  dedupeJourneysById,
  ensurePomCoverage,
} from "../lib/pipeline-batch.js";

export interface ChoreographerInput {
  registry: ComponentRegistry;
  targetUrl?: string;
  availablePoms: string[];
}

function componentsForPoms(
  registry: ComponentRegistry,
  poms: string[],
) {
  const names = new Set(poms.map((p) => componentNameFromPomClass(p)));
  return registry.components
    .filter((c) => names.has(c.name) && c.interactiveElements.length > 0)
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

const METHOD_ALIASES: Record<string, string> = {
  fillTextInput: "enterUsername",
  fillUsername: "enterUsername",
  fillText: "enterUsername",
  fillPasswordInput: "enterPassword",
  fillPassword: "enterPassword",
  clickButtonAction: "clickButtonAction",
};

function componentFromPom(pom: string): string {
  return pom.replace(/Page$/, "");
}

function normalizeStepMethod(step: JourneyStep): string {
  const alias = METHOD_ALIASES[step.method];
  if (alias && alias !== "clickButtonAction") {
    return alias;
  }
  if (step.method === "clickButtonAction") {
    return `click${componentFromPom(step.pom)}Action`;
  }
  return step.method;
}

function normalizeJourneySteps(journey: Journey): Journey {
  return {
    ...journey,
    steps: journey.steps.map((step) => ({
      ...step,
      method: normalizeStepMethod(step),
    })),
  };
}

function normalizePermissionBoundaryJourney(journey: Journey): Journey {
  if (journey.category !== "Permission Boundary") {
    return journey;
  }

  const steps = journey.steps.map((step) => {
    const onLoginPage =
      step.action === "navigate" &&
      (step.args?.some((a) => String(a).includes("/login")) ?? false);
    if (onLoginPage) return step;

    const assertsLoginForm =
      step.action === "assert_visible" &&
      (/form|login/i.test(step.method) ||
        /form|login/i.test(step.description ?? ""));

    if (assertsLoginForm) {
      return {
        ...step,
        action: "assert_state" as const,
        method: "assertRedirectToLogin",
        description:
          step.description ??
          "Verify unauthenticated access redirects to login",
      };
    }
    return step;
  });

  return { ...journey, steps };
}

function postProcessJourneys(journeys: Journey[]): Journey[] {
  return journeys
    .map(normalizeJourneySteps)
    .map(normalizePermissionBoundaryJourney)
    .map((j) => ({ ...j, priority: j.priority ?? "P1" }));
}

function filterValidJourneys(
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

async function generateBatchWithLlm(
  registry: ComponentRegistry,
  targetUrl: string | undefined,
  batchPoms: string[],
  journeyMin: number,
  journeyMax: number,
  batchIndex: number,
  batchCount: number,
): Promise<Journey[]> {
  const components = componentsForPoms(registry, batchPoms);
  const llm = new HigressClient(loadChoreographerLlmConfigFromEnv());

  console.info(
    `[choreographer] batch ${batchIndex}/${batchCount} poms=${batchPoms.join(",")} journeys=${journeyMin}-${journeyMax}`,
  );

  const result = await llm.chatJsonOrThrow(
    `You are Agent 5 Choreographer. Plan user test journeys for a React web app.
Return JSON { journeys: [...] } with ${journeyMin} to ${journeyMax} journeys.
Each journey MUST include: id (kebab-case), name, description, priority (P1-P4), category, gherkinText (full Gherkin Scenario with Given/When/Then), steps[].
category MUST be one of: ${JOURNEY_CATEGORIES.join(", ")}.
Each step: step (1-based), action (navigate|assert_visible|interact|assert_state), pom (MUST be from availablePoms), method, args (optional array), description.
Method vocabulary (use ONLY these patterns): navigateTo, waitForReady, enterUsername, enterPassword, submitLogin, click{Component}Action, assert{Element}Visible, assertRedirectToLogin.
Do NOT invent names like fillTextInput or fillPasswordInput.
For Permission Boundary journeys: assert redirect via assertRedirectToLogin (URL contains /login), NOT assertFormVisible on pages that were not navigated to /login.
Use only POM class names from availablePoms. Create at least one journey per POM in availablePoms. Vary categories across journeys when possible.`,
    JSON.stringify({
      targetUrl: targetUrl ?? "",
      availablePoms: batchPoms,
      components,
    }),
    journeyGenerationFromLlmSchema,
  );

  if (!result?.journeys?.length) {
    throw choreographerLlmError("LLM returned no journeys for batch");
  }

  const pomSet = new Set(batchPoms);
  const valid = filterValidJourneys(result.journeys as Journey[], pomSet);
  if (valid.length < journeyMin) {
    throw choreographerLlmError(
      `LLM returned ${valid.length} valid journeys for batch (need ${journeyMin}-${journeyMax})`,
    );
  }

  return postProcessJourneys(
    valid.slice(0, journeyMax).map((j): Journey => ({
      ...(j as Journey),
      category: j.category as Journey["category"],
      priority: j.priority ?? "P1",
    })),
  );
}

async function generateWithLlmBatched(
  registry: ComponentRegistry,
  targetUrl: string | undefined,
  availablePoms: string[],
  batchSize: number,
): Promise<Journey[]> {
  const batches = chunk(availablePoms, batchSize);
  const merged: Journey[] = [];

  for (let i = 0; i < batches.length; i += 1) {
    const batchPoms = batches[i]!;
    const journeyMin = batchPoms.length;
    const journeyMax = batchPoms.length;
    try {
      const batchJourneys = await generateBatchWithLlm(
        registry,
        targetUrl,
        batchPoms,
        journeyMin,
        journeyMax,
        i + 1,
        batches.length,
      );
      merged.push(...batchJourneys);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[choreographer] batch ${i + 1}/${batches.length} LLM failed: ${reason}`,
      );
    }
  }

  return dedupeJourneysById(merged);
}

async function generateWithLlm(
  registry: ComponentRegistry,
  targetUrl: string | undefined,
  availablePoms: string[],
  journeyMin: number,
  journeyMax: number,
): Promise<Journey[]> {
  const components = componentsForPoms(registry, availablePoms);
  const llm = new HigressClient(loadChoreographerLlmConfigFromEnv());

  let result;
  try {
    result = await llm.chatJsonOrThrow(
      `You are Agent 5 Choreographer. Plan user test journeys for a React web app.
Return JSON { journeys: [...] } with ${journeyMin} to ${journeyMax} journeys.
Each journey MUST include: id (kebab-case), name, description, priority (P1-P4), category, gherkinText (full Gherkin Scenario with Given/When/Then), steps[].
category MUST be one of: ${JOURNEY_CATEGORIES.join(", ")}.
Each step: step (1-based), action (navigate|assert_visible|interact|assert_state), pom (MUST be from availablePoms), method, args (optional array), description.
Method vocabulary (use ONLY these patterns): navigateTo, waitForReady, enterUsername, enterPassword, submitLogin, click{Component}Action, assert{Element}Visible, assertRedirectToLogin.
Do NOT invent names like fillTextInput or fillPasswordInput.
For Permission Boundary journeys: assert redirect via assertRedirectToLogin (URL contains /login), NOT assertFormVisible on pages that were not navigated to /login.
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
  const valid = filterValidJourneys(result.journeys as Journey[], pomSet);

  if (valid.length < journeyMin) {
    throw choreographerLlmError(
      `LLM returned ${valid.length} valid journeys (need ${journeyMin}-${journeyMax}). Check LLM config and retry the pipeline.`,
    );
  }

  return postProcessJourneys(
    valid.slice(0, journeyMax).map((j): Journey => ({
      ...(j as Journey),
      category: j.category as Journey["category"],
      priority: j.priority ?? "P1",
    })),
  );
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
  const scale = loadPipelineScaleConfigFromEnv();
  const availablePoms = input.availablePoms;

  if (availablePoms.length === 0) {
    throw new Error(
      "Choreographer: no POM classes found; run Set Designer first",
    );
  }

  let journeyMin: number;
  let journeyMax: number;
  if (scale.fullCoverage) {
    journeyMin = availablePoms.length;
    journeyMax = availablePoms.length;
  } else {
    ({ min: journeyMin, max: journeyMax } = loadJourneyConfigFromEnv());
  }

  let journeys: Journey[];
  if (scale.fullCoverage && availablePoms.length > scale.choreographerBatchSize) {
    journeys = await generateWithLlmBatched(
      input.registry,
      input.targetUrl,
      availablePoms,
      scale.choreographerBatchSize,
    );
  } else {
    try {
      journeys = await generateWithLlm(
        input.registry,
        input.targetUrl,
        availablePoms,
        journeyMin,
        journeyMax,
      );
    } catch (err) {
      if (!scale.fullCoverage) throw err;
      console.warn(
        `[choreographer] single-shot LLM failed in full coverage mode: ${err instanceof Error ? err.message : String(err)}`,
      );
      journeys = [];
    }
  }

  journeys = ensurePomCoverage(journeys, availablePoms, input.targetUrl);

  if (scale.fullCoverage && journeys.length < availablePoms.length) {
    throw choreographerLlmError(
      `Only ${journeys.length} journeys after coverage fill (need ${availablePoms.length})`,
    );
  }

  if (!scale.fullCoverage) {
    const { min: minRequired } = loadJourneyConfigFromEnv();
    if (journeys.length < minRequired) {
      throw choreographerLlmError(
        `Only ${journeys.length} journeys (need ${minRequired})`,
      );
    }
  }

  console.info(
    `[choreographer] journeys total=${journeys.length} poms=${availablePoms.length} fullCoverage=${scale.fullCoverage}`,
  );

  return buildDocument(input.registry, input.targetUrl, journeys);
}
