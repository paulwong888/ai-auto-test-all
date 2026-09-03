import type {
  ComponentRegistry,
  LocatorCatalog,
  TestIdInjections,
} from "../artifacts/types.js";

export function runBlockingCoach(
  registry: ComponentRegistry,
  injections: TestIdInjections,
): LocatorCatalog {
  const testIdByKey = new Map<string, string>();
  for (const p of injections.patches) {
    testIdByKey.set(`${p.component}:${p.elementRole}`, p.testId);
  }

  const locators: LocatorCatalog["locators"] = [];

  for (const comp of registry.components) {
    for (const el of comp.interactiveElements) {
      const key = `${comp.name}:${el.role}`;
      const testId = testIdByKey.get(key) ?? el.existingTestId;
      const priority: string[] = [];

      if (testId) {
        priority.push(`page.getByTestId('${testId}')`);
      }
      if (el.ariaLabel) {
        priority.push(
          `page.getByRole('${mapRole(el.elementType)}', { name: '${el.ariaLabel}' })`,
        );
      }
      if (el.attributes?.placeholder) {
        priority.push(`page.getByPlaceholder('${el.attributes.placeholder}')`);
      }
      if (el.attributes?.name) {
        priority.push(`page.locator('[name="${el.attributes.name}"]')`);
      }
      priority.push(
        `page.locator('${comp.name} ${el.elementType}[data-role="${el.role}"]')`,
      );

      locators.push({
        component: comp.name,
        element: el.role,
        testId,
        priority,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    locators,
  };
}

function mapRole(elementType: string): string {
  switch (elementType) {
    case "button":
      return "button";
    case "a":
      return "link";
    case "input":
      return "textbox";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    default:
      return elementType;
  }
}
