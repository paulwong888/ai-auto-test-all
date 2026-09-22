import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extractRouteConfig } from "./route-scanner.js";

const scanConfig = {
  maxFiles: 300,
  maxComponents: 80,
  includeReadOnlyPages: true,
};

const demoAppPath = path.resolve(
  import.meta.dirname,
  "../../../../../ai-auto-test-platform/sandbox-repos/demo-app",
);

const crmFrontPath = path.resolve(
  import.meta.dirname,
  "../../../../../../cs-help-desk-workspaces/casemanagement-reduxfrontend",
);

describe("extractRouteConfig demo-app", () => {
  it("extracts /, /login, /dashboard routes and nav links", async () => {
    const scan = await extractRouteConfig(demoAppPath, scanConfig);

    const paths = scan.routes.map((r) => r.path).sort();
    assert.deepEqual(paths, ["/", "/dashboard", "/login"]);

    const byPath = Object.fromEntries(scan.routes.map((r) => [r.path, r.component]));
    assert.equal(byPath["/"], "HomePage");
    assert.equal(byPath["/login"], "LoginPage");
    assert.equal(byPath["/dashboard"], "DashboardPage");

    assert.ok(scan.navLinks.some((l) => l.toPath === "/login"));
    assert.ok(scan.navLinks.some((l) => l.toPath === "/dashboard" && l.fromComponent === "App"));
    assert.ok(
      scan.navLinks.some(
        (l) => l.toPath === "/login" && l.fromComponent === "HomePage" && l.testId === "go-login",
      ),
    );
  });
});

const crmFrontDescribe = existsSync(crmFrontPath) ? describe : describe.skip;

crmFrontDescribe("extractRouteConfig crm-front legacy routes", () => {
  it("extracts legacy component={} routes from src/App.js", async () => {
    const scan = await extractRouteConfig(crmFrontPath, scanConfig);

    assert.ok(scan.routes.length >= 30, `expected >= 30 routes, got ${scan.routes.length}`);

    const byPath = Object.fromEntries(scan.routes.map((r) => [r.path, r.component]));
    assert.equal(byPath["/"], "Home");
    assert.equal(byPath["/SearchPage"], "SearchPage");
    assert.equal(byPath["/FormPage"], "FormPage");

    assert.ok(
      scan.routes.some((r) => r.sourceFile === "src/App.js"),
      "expected routes from src/App.js",
    );
  });

  it("extracts nested CreditControl and Waiving routes", async () => {
    const scan = await extractRouteConfig(crmFrontPath, scanConfig);

    assert.ok(
      scan.routes.some(
        (r) =>
          r.path === "/approval/CreditControl/blacklist" &&
          r.component === "Blacklist",
      ),
      "expected CreditControl blacklist route",
    );
    assert.ok(
      scan.routes.some(
        (r) =>
          r.path === "/WaivingApproval/general" &&
          r.component === "WaivingPageContent",
      ),
      "expected Waiving nested route",
    );
  });

  it("extracts linkTo nav links and conditional feature flags from App.js", async () => {
    const scan = await extractRouteConfig(crmFrontPath, scanConfig);

    assert.ok(
      scan.navLinks.some(
        (l) => l.toPath === "/approval/CreditControl/blacklist",
      ),
      "expected UI linkTo for CreditControl blacklist",
    );

    const formPageRoute = scan.routes.find((r) => r.path === "/FormPage");
    assert.ok(formPageRoute?.requiresFeatureFlag, "FormPage should have feature flag");
    assert.equal(formPageRoute?.public, false);
  });
});
