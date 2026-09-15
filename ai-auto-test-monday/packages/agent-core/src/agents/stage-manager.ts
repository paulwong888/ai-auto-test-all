import type {
  ApplyReport,
  ComponentRegistry,
  InjectionPatch,
  TestIdInjections,
} from "../artifacts/types.js";
import { applyTestIdPatches, writeBackupMarker } from "../codemods/index.js";

function toTestId(component: string, role: string): string {
  const desc = role.replace(/-input$/, "Input").replace(/-/g, "");
  return `${component}-${desc.charAt(0).toLowerCase()}${desc.slice(1)}`;
}

function auditUniqueness(patches: InjectionPatch[]): InjectionPatch[] {
  const testIdOwners = new Map<string, InjectionPatch>();
  const result: InjectionPatch[] = [];

  for (const patch of patches) {
    if (
      patch.action !== "inject-testid" &&
      patch.action !== "rename-existing-testid" &&
      patch.action !== "resolve-conflict"
    ) {
      result.push(patch);
      continue;
    }

    const owner = testIdOwners.get(patch.testId);
    if (owner && owner.file !== patch.file) {
      result.push({
        ...patch,
        action: "resolve-conflict",
        previousTestId: patch.testId,
        testId: `${patch.testId}-${patch.component}`,
      });
      testIdOwners.set(`${patch.testId}-${patch.component}`, patch);
    } else {
      testIdOwners.set(patch.testId, patch);
      result.push(patch);
    }
  }

  return result;
}

export interface StageManagerOptions {
  dryRun?: boolean;
  repoRoot?: string;
  runId?: string;
}

export function runStageManager(
  registry: ComponentRegistry,
  options: StageManagerOptions = {},
): TestIdInjections {
  const dryRun = options.dryRun !== false;
  const patches: InjectionPatch[] = [];

  for (const comp of registry.components) {
    for (const el of comp.interactiveElements) {
      if (el.existingTestId) {
        const semantic = !/^test-\d+$/.test(el.existingTestId);
        if (semantic) {
          patches.push({
            file: comp.filePath,
            line: el.line ?? 1,
            component: comp.name,
            elementRole: el.role,
            testId: el.existingTestId,
            action: "uses-existing-testid",
          });
        } else {
          patches.push({
            file: comp.filePath,
            line: el.line ?? 1,
            component: comp.name,
            elementRole: el.role,
            testId: toTestId(comp.name, el.role),
            action: "rename-existing-testid",
            previousTestId: el.existingTestId,
          });
        }
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
    dryRun,
    generatedAt: new Date().toISOString(),
    patches: auditUniqueness(patches),
  };
}

export async function applyStageManagerPatches(
  injections: TestIdInjections,
  repoRoot: string,
  runId: string,
): Promise<ApplyReport> {
  await writeBackupMarker(repoRoot, runId);
  return applyTestIdPatches(repoRoot, injections.patches);
}
