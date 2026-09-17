import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ComponentRegistry, Journey } from "../artifacts/types.js";
import {
  extractRegistryUsername,
  injectE2eCredentials,
  isPublicHomeModel,
  normalizeJourneysForExecution,
  normalizeLoginHappyPathJourney,
  normalizePermissionBoundaryJourney,
} from "./journey-normalize.js";

const demoRegistry: ComponentRegistry = {
  version: "2.0",
  projectId: "demo",
  runId: "test",
  frontendPath: "/demo",
  scannedAt: "2026-01-01T00:00:00.000Z",
  scanStats: { filesScanned: 5, componentsFound: 2, parseErrors: 0 },
  components: [
    {
      name: "LoginPage",
      type: "react",
      filePath: "src/pages/LoginPage.tsx",
      interactiveElements: [
        {
          elementType: "button",
          role: "button",
          attributes: { "aria-label": "登录按钮" },
        },
      ],
      conditionalRendering: [
        { condition: 'username === "admin"', type: "and-short-circuit" },
      ],
    },
    {
      name: "HomePage",
      type: "react",
      filePath: "src/pages/HomePage.tsx",
      interactiveElements: [
        {
          elementType: "a",
          role: "link",
          attributes: { href: "/login", "data-testid": "go-login" },
          existingTestId: "go-login",
        },
      ],
    },
  ],
};

const loginHappyJourney: Journey = {
  id: "user-login-successful-navigation",
  name: "User login and successful navigation to home page",
  category: "Happy Path",
  gherkinText: "Scenario: login",
  steps: [
    {
      step: 1,
      action: "navigate",
      pom: "LoginPagePage",
      method: "navigateTo",
      args: ["http://localhost/login"],
    },
    {
      step: 2,
      action: "interact",
      pom: "LoginPagePage",
      method: "enterUsername",
      args: ["validUser"],
    },
    {
      step: 3,
      action: "interact",
      pom: "LoginPagePage",
      method: "enterPassword",
      args: ["validPass"],
    },
    {
      step: 4,
      action: "interact",
      pom: "LoginPagePage",
      method: "submitLogin",
    },
    {
      step: 5,
      action: "assert_state",
      pom: "HomePagePage",
      method: "assertRedirectToLogin",
      description: "Wait for redirect to home page",
    },
    {
      step: 6,
      action: "assert_visible",
      pom: "HomePagePage",
      method: "assertLinkVisible",
      description: "Verify home page navigation link is visible",
    },
  ],
};

const permissionBoundaryJourney: Journey = {
  id: "unauthenticated-access-redirects-to-login",
  name: "Unauthenticated access to home page redirects to login",
  category: "Permission Boundary",
  gherkinText: "Scenario: unauth",
  steps: [
    {
      step: 1,
      action: "navigate",
      pom: "HomePagePage",
      method: "navigateTo",
      args: ["http://localhost/"],
    },
    {
      step: 2,
      action: "assert_state",
      pom: "LoginPagePage",
      method: "assertRedirectToLogin",
    },
    {
      step: 3,
      action: "assert_state",
      pom: "LoginPagePage",
      method: "assertRedirectToLogin",
      description: "Verify the login form is visible",
    },
  ],
};

describe("journey-normalize", () => {
  it("detects public home model from demo registry", () => {
    assert.equal(isPublicHomeModel(demoRegistry), true);
    assert.equal(extractRegistryUsername(demoRegistry), "admin");
  });

  it("normalizes login happy path post-login assertions", () => {
    const fixed = normalizeLoginHappyPathJourney(loginHappyJourney, demoRegistry);
    assert.equal(fixed.steps[4]?.method, "assertRedirectToDashboard");
    assert.equal(fixed.steps[4]?.pom, "LoginPagePage");
    assert.equal(fixed.steps[5]?.method, "assertLoginSuccessVisible");
    assert.equal(fixed.steps[5]?.pom, "LoginPagePage");
  });

  it("normalizes public home permission boundary journeys", () => {
    const fixed = normalizePermissionBoundaryJourney(
      permissionBoundaryJourney,
      demoRegistry,
      "http://localhost/",
    );
    assert.equal(fixed.steps[1]?.method, "assertLinkVisible");
    assert.equal(fixed.steps[1]?.pom, "HomePagePage");
    assert.equal(fixed.steps[2]?.method, "clickGoLoginLink");
    assert.equal(fixed.steps[3]?.method, "assertFormVisible");
  });

  it("injects e2e credentials and registry username fallback", () => {
    const journeys = injectE2eCredentials(
      [loginHappyJourney],
      { username: "admin", password: "123456" },
      demoRegistry,
    );
    assert.equal(journeys[0]?.steps[1]?.args?.[0], "admin");
    assert.equal(journeys[0]?.steps[2]?.args?.[0], "123456");
  });

  it("normalizeJourneysForExecution applies all fixes", () => {
    const fixed = normalizeJourneysForExecution([loginHappyJourney], {
      registry: demoRegistry,
      e2eAuth: { username: "admin", password: "123456" },
    });
    assert.equal(fixed[0]?.steps[1]?.args?.[0], "admin");
    assert.equal(fixed[0]?.steps[4]?.method, "assertRedirectToDashboard");
  });
});
