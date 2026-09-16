export function parseSpecPomCalls(
  specContent: string,
): Array<{ varName: string; method: string }> {
  const calls: Array<{ varName: string; method: string }> = [];
  const re = /await\s+(\w+)\.(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(specContent)) !== null) {
    const varName = match[1]!;
    if (!varName.endsWith("Page") && !/\w+Page$/.test(varName)) {
      // variable names are camelCase of class e.g. holdSuspensionPage
      if (!varName.toLowerCase().includes("page")) continue;
    }
    calls.push({ varName: match[1]!, method: match[2]! });
  }
  return calls;
}

export function resolvePomClassFromVarName(
  varName: string,
  pomClasses: string[],
): string | null {
  const lower = varName.toLowerCase();
  for (const cls of pomClasses) {
    const expected = cls.charAt(0).toLowerCase() + cls.slice(1);
    if (lower === expected.toLowerCase()) return cls;
  }
  return null;
}

export function findSpecPomMethodMismatches(
  specContent: string,
  pomMethods: Map<string, Set<string>>,
): string[] {
  const pomClasses = [...pomMethods.keys()];
  const missing: string[] = [];
  for (const { varName, method } of parseSpecPomCalls(specContent)) {
    if (method === "goto") continue;
    const pomClass = resolvePomClassFromVarName(varName, pomClasses);
    if (!pomClass) continue;
    const methods = pomMethods.get(pomClass);
    if (!methods?.has(method)) {
      missing.push(`${pomClass}.${method} (via ${varName}.${method})`);
    }
  }
  return missing;
}

export function journeyNeedsUnauthenticatedContext(journey: {
  category?: string;
  steps: Array<{ method: string; description?: string; action: string; args?: unknown[] }>;
}): boolean {
  if (
    journey.steps.some(
      (s) =>
        s.method === "assertRedirectToLogin" ||
        /assertRedirectToLogin/i.test(s.method),
    )
  ) {
    return true;
  }
  if (journey.category !== "Permission Boundary") return false;
  return journey.steps.some(
    (s) =>
      s.action === "assert_state" ||
      /unauth|without.*login|redirect.*login|permission/i.test(
        s.description ?? "",
      ),
  );
}
