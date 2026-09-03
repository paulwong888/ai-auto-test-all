import type { ComponentRegistry, TestIdInjections } from "../artifacts/types.js";

function toTestId(component: string, role: string): string {
  const desc = role.replace(/-input$/, "Input").replace(/-/g, "");
  return `${component}-${desc.charAt(0).toLowerCase()}${desc.slice(1)}`;
}

export function runStageManager(registry: ComponentRegistry): TestIdInjections {
  const patches: TestIdInjections["patches"] = [];

  for (const comp of registry.components) {
    for (const el of comp.interactiveElements) {
      if (el.existingTestId) {
        patches.push({
          file: comp.filePath,
          line: el.line ?? 1,
          component: comp.name,
          elementRole: el.role,
          testId: el.existingTestId,
          action: "uses-existing-testid",
        });
        continue;
      }

      if (el.ariaLabel) {
        patches.push({
          file: comp.filePath,
          line: el.line ?? 1,
          component: comp.name,
          elementRole: el.role,
          testId: toTestId(comp.name, el.role),
          action: "uses-existing-aria-label",
          snippet: `<!-- would use getByLabel('${el.ariaLabel}') -->`,
        });
        continue;
      }

      const testId = toTestId(comp.name, el.role);
      patches.push({
        file: comp.filePath,
        line: el.line ?? 1,
        component: comp.name,
        elementRole: el.role,
        testId,
        action: "inject-testid",
        snippet: ` data-testid="${testId}"`,
      });
    }
  }

  return {
    dryRun: true,
    generatedAt: new Date().toISOString(),
    patches,
  };
}
