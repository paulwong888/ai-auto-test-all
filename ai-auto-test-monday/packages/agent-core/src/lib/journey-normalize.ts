import type {
  ComponentRegistry,
  Journey,
  JourneyStep,
} from "../artifacts/types.js";
import type { E2eAuthConfig } from "../types.js";
import { pomClassFromComponentName } from "./pipeline-batch.js";

const CREDENTIAL_PLACEHOLDERS = new Set([
  "validuser",
  "validpass",
  "valid_user",
  "valid_pass",
  "testuser",
  "testpass",
  "placeholder",
  "example",
  "foo",
  "bar",
]);

function isCredentialPlaceholder(value: string): boolean {
  return CREDENTIAL_PLACEHOLDERS.has(value.trim().toLowerCase());
}

function loginPomClass(registry: ComponentRegistry): string {
  const login = registry.components.find((c) => /login/i.test(c.name));
  return login ? pomClassFromComponentName(login.name) : "LoginPagePage";
}

function homePomClass(registry: ComponentRegistry): string {
  const home = registry.components.find((c) => /home/i.test(c.name));
  return home ? pomClassFromComponentName(home.name) : "HomePagePage";
}

export function isPublicHomeModel(registry: ComponentRegistry): boolean {
  const home = registry.components.find((c) => /home/i.test(c.name));
  const login = registry.components.find((c) => /login/i.test(c.name));
  if (!home || !login) return false;

  const hasGoLoginLink = home.interactiveElements.some(
    (el) =>
      el.existingTestId === "go-login" ||
      el.attributes?.["data-testid"] === "go-login" ||
      el.attributes?.href === "/login",
  );
  if (!hasGoLoginLink) return false;

  const hasLoginSuccessBranch = (login.conditionalRendering ?? []).some(
    (c) =>
      /username\s*===/.test(c.condition) ||
      /dashboard/i.test(c.condition) ||
      /navigate/i.test(c.renders ?? ""),
  );

  const hasRouteGuard = registry.components.some(
    (c) =>
      /protected|guard|authroute|requireauth/i.test(c.name) ||
      /protected|guard|requireauth/i.test(c.filePath),
  );

  return hasLoginSuccessBranch && !hasRouteGuard;
}

export function extractRegistryUsername(registry: ComponentRegistry): string | null {
  const login = registry.components.find((c) => /login/i.test(c.name));
  if (!login?.conditionalRendering?.length) return null;
  for (const cond of login.conditionalRendering) {
    const match = cond.condition.match(/username\s*===\s*["']([^"']+)["']/);
    if (match?.[1]) return match[1];
  }
  return null;
}

function stepNavigatesToHome(step: JourneyStep, targetUrl?: string): boolean {
  if (step.action !== "navigate") return false;
  const args = step.args?.map(String) ?? [];
  if (args.some((a) => /\/login\b/i.test(a))) return false;
  if (args.some((a) => !/\/login/i.test(a) && (/\/$/.test(a) || /\/home/i.test(a)))) {
    return true;
  }
  if (targetUrl && args.some((a) => a === targetUrl || a === `${targetUrl}/`)) {
    return true;
  }
  return args.some((a) => /\/$/.test(a) && !/\/login/i.test(a));
}

export function injectE2eCredentials(
  journeys: Journey[],
  e2eAuth?: E2eAuthConfig,
  registry?: ComponentRegistry,
): Journey[] {
  const registryUsername = registry ? extractRegistryUsername(registry) : null;

  return journeys.map((journey) => ({
    ...journey,
    steps: journey.steps.map((step) => {
      if (step.action !== "interact") return step;
      const args = step.args ? [...step.args] : undefined;
      if (!args?.length) return step;

      if (
        step.method === "enterUsername" &&
        typeof args[0] === "string" &&
        isCredentialPlaceholder(args[0])
      ) {
        args[0] = e2eAuth?.username ?? registryUsername ?? args[0];
      }
      if (
        step.method === "enterPassword" &&
        typeof args[0] === "string" &&
        isCredentialPlaceholder(args[0])
      ) {
        if (e2eAuth?.password) {
          args[0] = e2eAuth.password;
        }
      }

      return { ...step, args };
    }),
  }));
}

export function normalizeLoginHappyPathJourney(
  journey: Journey,
  registry: ComponentRegistry,
): Journey {
  const isHappyPath =
    journey.category === "Happy Path" ||
    /login|log in|sign in|successful/i.test(journey.name);
  if (!isHappyPath) return journey;

  const submitIdx = journey.steps.findIndex((s) => s.method === "submitLogin");
  if (submitIdx < 0) return journey;

  const loginPom = loginPomClass(registry);
  const homePom = homePomClass(registry);

  const steps = journey.steps.map((step, idx) => {
    if (idx <= submitIdx) return step;

    if (
      step.method === "assertRedirectToLogin" ||
      (/redirect/i.test(step.description ?? "") &&
        step.action === "assert_state")
    ) {
      return {
        ...step,
        pom: loginPom,
        action: "assert_state" as const,
        method: "assertRedirectToDashboard",
        description:
          step.description ??
          "Verify redirect to dashboard after successful login",
      };
    }

    if (
      step.method === "assertLinkVisible" &&
      step.pom === homePom &&
      /home|link|navigation/i.test(step.description ?? journey.name)
    ) {
      return {
        ...step,
        pom: loginPom,
        action: "assert_visible" as const,
        method: "assertLoginSuccessVisible",
        description:
          step.description ?? "Verify login success message is visible",
      };
    }

    return step;
  });

  return { ...journey, steps };
}

export function normalizePermissionBoundaryJourney(
  journey: Journey,
  registry: ComponentRegistry,
  targetUrl?: string,
): Journey {
  if (journey.category !== "Permission Boundary") {
    return journey;
  }

  const loginPom = loginPomClass(registry);
  const homePom = homePomClass(registry);
  const publicHome = isPublicHomeModel(registry);

  if (publicHome) {
    const homeNavIdx = journey.steps.findIndex((s) =>
      stepNavigatesToHome(s, targetUrl),
    );
    if (homeNavIdx < 0) return journey;

    const steps: JourneyStep[] = [];
    let replacedRedirect = false;

    for (let i = 0; i < journey.steps.length; i += 1) {
      const step = journey.steps[i]!;

      if (
        i > homeNavIdx &&
        !replacedRedirect &&
        step.method === "assertRedirectToLogin"
      ) {
        replacedRedirect = true;
        steps.push({
          ...step,
          pom: homePom,
          action: "assert_visible",
          method: "assertLinkVisible",
          description:
            step.description ??
            "Verify unauthenticated user sees login link on public home page",
        });
        continue;
      }

      if (
        i > homeNavIdx &&
        replacedRedirect &&
        (step.method === "assertRedirectToLogin" ||
          (/form|login/i.test(step.description ?? "") &&
            step.action === "assert_state"))
      ) {
        steps.push({
          step: step.step,
          action: "interact",
          pom: homePom,
          method: "clickGoLoginLink",
          description: "Navigate to login via home page link",
        });
        steps.push({
          step: step.step,
          action: "assert_visible",
          pom: loginPom,
          method: "assertFormVisible",
          description:
            step.description ?? "Verify the login form is visible",
        });
        continue;
      }

      const onLoginPage =
        step.action === "navigate" &&
        (step.args?.some((a) => String(a).includes("/login")) ?? false);
      if (onLoginPage) {
        steps.push(step);
        continue;
      }

      const assertsLoginForm =
        step.action === "assert_visible" &&
        (/form|login/i.test(step.method) ||
          /form|login/i.test(step.description ?? ""));

      if (assertsLoginForm && !publicHome) {
        steps.push({
          ...step,
          action: "assert_state",
          method: "assertRedirectToLogin",
          description:
            step.description ??
            "Verify unauthenticated access redirects to login",
        });
        continue;
      }

      steps.push(step);
    }

    return {
      ...journey,
      steps: steps.map((s, idx) => ({ ...s, step: idx + 1 })),
    };
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

export function normalizeJourneysForExecution(
  journeys: Journey[],
  opts: {
    registry: ComponentRegistry;
    targetUrl?: string;
    e2eAuth?: E2eAuthConfig;
  },
): Journey[] {
  let result = journeys.map((j) =>
    normalizePermissionBoundaryJourney(j, opts.registry, opts.targetUrl),
  );
  result = result.map((j) => normalizeLoginHappyPathJourney(j, opts.registry));
  result = injectE2eCredentials(result, opts.e2eAuth, opts.registry);
  return result;
}
