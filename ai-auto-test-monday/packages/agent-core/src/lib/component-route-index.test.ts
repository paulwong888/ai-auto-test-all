import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extractRouteConfig } from "../scanner/route-scanner.js";
import {
  resolveNavigatePath,
  resolveJourneyNavigatePaths,
} from "./component-route-index.js";
import type { ComponentRegistry, Journey } from "../artifacts/types.js";

const scanConfig = {
  maxFiles: 300,
  maxComponents: 80,
  includeReadOnlyPages: true,
};

const crmFrontPath = path.resolve(
  import.meta.dirname,
  "../../../../../../cs-help-desk-workspaces/casemanagement-reduxfrontend",
);

const crmDescribe = existsSync(crmFrontPath) ? describe : describe.skip;

crmDescribe("component-route-index crm-front", () => {
  it("resolves BlacklistPage to CreditControl blacklist route", async () => {
    const scan = await extractRouteConfig(crmFrontPath, scanConfig);
    const routeConfig = {
      version: "1.0" as const,
      generatedAt: "2026-01-01T00:00:00.000Z",
      framework: "react-router",
      routes: scan.routes,
    };

    const minimalRegistry: ComponentRegistry = {
      version: "2.0",
      projectId: "crm-front",
      runId: "test",
      frontendPath: crmFrontPath,
      scannedAt: "2026-01-01T00:00:00.000Z",
      scanStats: { filesScanned: 1, componentsFound: 3, parseErrors: 0 },
      components: [
        {
          name: "Blacklist",
          type: "react",
          filePath: "src/CreditControl/Blacklist/Blacklist.jsx",
          interactiveElements: [],
        },
        {
          name: "AddNewTaskForm",
          type: "react",
          filePath: "src/Case/ViewCase/TaskDetail/AddNewTaskForm.jsx",
          interactiveElements: [],
        },
        {
          name: "TaskDetail",
          type: "react",
          filePath: "src/Case/ViewCase/TaskDetail/TaskDetail.jsx",
          interactiveElements: [],
        },
        {
          name: "FormPageContent",
          type: "react",
          filePath: "src/Case/ViewCase/Formpage/FormPageContent.js",
          interactiveElements: [],
        },
        {
          name: "CaseFormPage",
          type: "react",
          filePath: "src/Case/ViewCase/Formpage/CaseFormPage.js",
          interactiveElements: [],
        },
      ],
    };

    const blacklistPath = resolveNavigatePath(
      "BlacklistPage",
      routeConfig,
      minimalRegistry,
    );
    assert.equal(blacklistPath, "/approval/CreditControl/blacklist");

    const addTaskPath = resolveNavigatePath(
      "AddNewTaskFormPage",
      routeConfig,
      minimalRegistry,
    );
    assert.equal(addTaskPath, "/Form");
  });

  it("fixes 523bbb08-style wrong navigate paths in journeys", async () => {
    const scan = await extractRouteConfig(crmFrontPath, scanConfig);
    const routeConfig = {
      version: "1.0" as const,
      generatedAt: "2026-01-01T00:00:00.000Z",
      framework: "react-router",
      routes: scan.routes,
    };

    const registry: ComponentRegistry = {
      version: "2.0",
      projectId: "crm-front",
      runId: "test",
      frontendPath: crmFrontPath,
      scannedAt: "2026-01-01T00:00:00.000Z",
      scanStats: { filesScanned: 1, componentsFound: 2, parseErrors: 0 },
      components: [
        {
          name: "Blacklist",
          type: "react",
          filePath: "src/CreditControl/Blacklist/Blacklist.jsx",
          interactiveElements: [],
        },
        {
          name: "CancelOrder",
          type: "react",
          filePath: "src/CreditControl/CancelOrder/CancelOrder.jsx",
          interactiveElements: [],
        },
      ],
    };

    const journeys: Journey[] = [
      {
        id: "blacklist-approval-error-handling",
        name: "Blacklist",
        category: "Error Handling",
        gherkinText: "Scenario: x",
        steps: [
          {
            step: 1,
            action: "navigate",
            pom: "BlacklistPage",
            method: "navigateTo",
            args: ["/blacklist/approval"],
          },
        ],
      },
      {
        id: "cancel-order-reject-workflow",
        name: "Cancel",
        category: "Error Handling",
        gherkinText: "Scenario: x",
        steps: [
          {
            step: 1,
            action: "navigate",
            pom: "CancelOrderPage",
            method: "navigateTo",
            args: ["/approval/CreditControl/CancelOrder"],
          },
        ],
      },
    ];

    const fixed = resolveJourneyNavigatePaths(journeys, routeConfig, registry);
    assert.equal(
      fixed[0]!.steps[0]!.args![0],
      "/approval/CreditControl/blacklist",
    );
    assert.equal(
      fixed[1]!.steps[0]!.args![0],
      "/approval/CreditControl/cancelOrder",
    );
  });
});
