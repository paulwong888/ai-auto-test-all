import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extractRouteConfig } from "./route-scanner.js";
import {
  applyPublicFlagsToRoutes,
  extractPermissionModel,
} from "./permission-scanner.js";

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

describe("extractPermissionModel demo-app", () => {
  it("infers business-flow guard for /dashboard without fake route-guard", async () => {
    const routeScan = await extractRouteConfig(demoAppPath, scanConfig);
    const permission = await extractPermissionModel(
      demoAppPath,
      routeScan.routes,
      scanConfig,
    );

    const dashboardGuard = permission.guards.find((g) => g.route === "/dashboard");
    assert.ok(dashboardGuard);
    assert.equal(dashboardGuard.guardType, "business-flow");
    assert.match(dashboardGuard.evidence ?? "", /LoginPage success navigates to \/dashboard/);

    const routeGuards = permission.guards.filter((g) => g.guardType === "route-guard");
    assert.equal(routeGuards.length, 0);

    const routesWithPublic = applyPublicFlagsToRoutes(routeScan.routes, permission.guards);
    const dashboardRoute = routesWithPublic.find((r) => r.path === "/dashboard");
    assert.equal(dashboardRoute?.public, false);
    assert.equal(routesWithPublic.find((r) => r.path === "/")?.public, true);
  });
});

const crmFrontDescribe = existsSync(crmFrontPath) ? describe : describe.skip;

crmFrontDescribe("extractPermissionModel crm-front", () => {
  it("builds permission model from legacy routes without throwing", async () => {
    const routeScan = await extractRouteConfig(crmFrontPath, scanConfig);
    assert.ok(routeScan.routes.length >= 30);

    const permission = await extractPermissionModel(
      crmFrontPath,
      routeScan.routes,
      scanConfig,
    );

    assert.deepEqual(permission.roles, ["guest", "authenticated"]);
    assert.ok(Array.isArray(permission.guards));
  });
});
