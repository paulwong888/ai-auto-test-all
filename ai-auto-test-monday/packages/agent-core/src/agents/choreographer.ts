import type {
  ComponentRegistry,
  JourneysDocument,
  Journey,
  JourneyStep,
  PermissionModelDocument,
  RouteConfigDocument,
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
import { buildComponentRoutesMap } from "../lib/component-route-index.js";
import { normalizeJourneysForExecution } from "../lib/journey-normalize.js";
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
  routeConfig?: RouteConfigDocument;
  permissionModel?: PermissionModelDocument;
}

function buildRoutePermissionContext(input: ChoreographerInput) {
  const routes = input.routeConfig?.routes ?? [];
  const navLinks = input.routeConfig?.navLinks ?? [];
  const guards =
    input.permissionModel?.guards.filter((g) => g.guardType !== "none") ?? [];

  if (routes.length === 0 && navLinks.length === 0 && guards.length === 0) {
    return undefined;
  }

  const componentRoutes =
    routes.length > 0
      ? buildComponentRoutesMap(input.registry, routes)
      : undefined;

  return {
    routes: routes.map((r) => ({
      path: r.path,
      component: r.component,
      public: r.public ?? true,
      requiresFeatureFlag: r.requiresFeatureFlag,
    })),
    navLinks: navLinks.map((l) => ({
      from: l.fromComponent,
      to: l.toPath,
      testId: l.testId,
    })),
    guards: guards.map((g) => ({
      route: g.route,
      allowedRoles: g.allowedRoles,
      guardType: g.guardType,
      unauthenticatedBehavior: g.unauthenticatedBehavior,
      evidence: g.evidence,
    })),
    componentRoutes,
  };
}

function routePermissionPromptBlock(input: ChoreographerInput): string {
  const ctx = buildRoutePermissionContext(input);
  if (!ctx) return "";

  return `
Use routeConfig and permissionModel when planning journeys:
- For routes with guardType route-guard or business-flow, plan Permission Boundary journeys (unauthenticated redirect or login-required access).
- For navLinks, plan Cross-Page journeys that follow link navigation between pages.
- business-flow guards mean auth is enforced in login success navigation, not necessarily a router PrivateRoute.
- For navigateTo steps, path MUST come from componentRoutes[componentName] in the context below. Do NOT invent paths.
- Path casing MUST match componentRoutes exactly (e.g. cancelOrder not CancelOrder).
Route/permission context:
${JSON.stringify(ctx)}`;
}

function componentsForPoms(
  registry: ComponentRegistry,
  poms: string[],
) {
  const names = new Set(poms.map((p) => componentNameFromPomClass(p)));
  return registry.components
    .filter(
      (c) =>
        names.has(c.name) &&
        (c.interactiveElements.length > 0 ||
          c.pageKind === "read-only" ||
          c.name.endsWith("Page")),
    )
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

function postProcessJourneys(
  journeys: Journey[],
  input: ChoreographerInput,
): Journey[] {
  const normalized = journeys
    .map(normalizeJourneySteps)
    .map((j) => ({ ...j, priority: j.priority ?? "P1" }));
  return normalizeJourneysForExecution(normalized, {
    registry: input.registry,
    targetUrl: input.targetUrl,
    routeConfig: input.routeConfig,
  });
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
  input: ChoreographerInput,
  batchPoms: string[],
  journeyMin: number,
  journeyMax: number,
  batchIndex: number,
  batchCount: number,
): Promise<Journey[]> {
  const components = componentsForPoms(input.registry, batchPoms);
  const llm = new HigressClient(loadChoreographerLlmConfigFromEnv(), "choreographer");

  console.info(
    `[choreographer] batch ${batchIndex}/${batchCount} poms=${batchPoms.join(",")} journeys=${journeyMin}-${journeyMax}`,
  );

  const result = await llm.chatJsonOrThrow(
    `You are Agent 5 Choreographer. Plan user test journeys for a React web app.
Return JSON { journeys: [...] } with ${journeyMin} to ${journeyMax} journeys.
Each journey MUST include: id (kebab-case), name, description, priority (P1-P4), category, gherkinText (full Gherkin Scenario with Given/When/Then), steps[].
category MUST be one of: ${JOURNEY_CATEGORIES.join(", ")}.
Each step: step (1-based), action (navigate|assert_visible|interact|assert_state), pom (MUST be from availablePoms), method, args (optional array), description.
Method vocabulary (use ONLY these patterns): navigateTo, waitForReady, enterUsername, enterPassword, submitLogin, clickGoLoginLink, click{Component}Action, assert{Element}Visible, assertRedirectToLogin, assertRedirectToDashboard, assertLoginSuccessVisible.
Do NOT invent names like fillTextInput or fillPasswordInput.
For login success journeys: after submitLogin use assertRedirectToDashboard and assertLoginSuccessVisible (not assertLinkVisible on home).
For Permission Boundary on public home pages: use HomePage assertLinkVisible for go-login, then clickGoLoginLink + LoginPage assertFormVisible.
Use only POM class names from availablePoms. Create at least one journey per POM in availablePoms. Vary categories across journeys when possible.${routePermissionPromptBlock(input)}`,
    JSON.stringify({
      targetUrl: input.targetUrl ?? "",
      availablePoms: batchPoms,
      components,
      routePermission: buildRoutePermissionContext(input),
    }),
    journeyGenerationFromLlmSchema,
    "journey_generation",
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
    input,
  );
}

async function generateWithLlmBatched(
  input: ChoreographerInput,
  batchSize: number,
): Promise<Journey[]> {
  const batches = chunk(input.availablePoms, batchSize);
  const merged: Journey[] = [];

  for (let i = 0; i < batches.length; i += 1) {
    const batchPoms = batches[i]!;
    const journeyMin = batchPoms.length;
    const journeyMax = batchPoms.length;
    try {
      const batchJourneys = await generateBatchWithLlm(
        input,
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
  input: ChoreographerInput,
  journeyMin: number,
  journeyMax: number,
): Promise<Journey[]> {
  const components = componentsForPoms(input.registry, input.availablePoms);
  const llm = new HigressClient(loadChoreographerLlmConfigFromEnv(), "choreographer");

  let result;
  try {
    result = await llm.chatJsonOrThrow(
      `You are Agent 5 Choreographer. Plan user test journeys for a React web app.
Return JSON { journeys: [...] } with ${journeyMin} to ${journeyMax} journeys.
Each journey MUST include: id (kebab-case), name, description, priority (P1-P4), category, gherkinText (full Gherkin Scenario with Given/When/Then), steps[].
category MUST be one of: ${JOURNEY_CATEGORIES.join(", ")}.
Each step: step (1-based), action (navigate|assert_visible|interact|assert_state), pom (MUST be from availablePoms), method, args (optional array), description.
Method vocabulary (use ONLY these patterns): navigateTo, waitForReady, enterUsername, enterPassword, submitLogin, clickGoLoginLink, click{Component}Action, assert{Element}Visible, assertRedirectToLogin, assertRedirectToDashboard, assertLoginSuccessVisible.
Do NOT invent names like fillTextInput or fillPasswordInput.
For login success journeys: after submitLogin use assertRedirectToDashboard and assertLoginSuccessVisible.
For Permission Boundary on public home pages: use HomePage assertLinkVisible, then clickGoLoginLink + LoginPage assertFormVisible.
Use only POM class names from availablePoms. Cover different top components across journeys.
For navigateTo steps, path MUST come from componentRoutes[componentName]. Do NOT invent paths. Match casing exactly.${routePermissionPromptBlock(input)}`,
      JSON.stringify({
        targetUrl: input.targetUrl ?? "",
        availablePoms: input.availablePoms,
        components,
        routePermission: buildRoutePermissionContext(input),
      }),
      journeyGenerationFromLlmSchema,
      "journey_generation",
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

  const pomSet = new Set(input.availablePoms);
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
    input,
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
    journeys = await generateWithLlmBatched(input, scale.choreographerBatchSize);
  } else {
    try {
      journeys = await generateWithLlm(input, journeyMin, journeyMax);
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
