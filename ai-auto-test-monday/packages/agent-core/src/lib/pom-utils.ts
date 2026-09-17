import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Journey, LocatorCatalog } from "../artifacts/types.js";

export function pomFileNameToClassName(fileName: string): string {
  const base = fileName.replace(/\.ts$/, "");
  return base.endsWith("Page") ? base : `${base}Page`;
}

export function componentToPomClass(componentName: string): string {
  return `${componentName}Page`;
}

export function componentToPomFileName(componentName: string): string {
  return `${componentName}Page.ts`;
}

export function parsePomMethods(content: string): Set<string> {
  const methods = new Set<string>();
  const re = /async\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    methods.add(match[1]!);
  }
  return methods;
}

export function parsePomClassName(content: string): string | null {
  const match = content.match(/export\s+class\s+(\w+)/);
  return match?.[1] ?? null;
}

export function expectedPomFileName(componentName: string): string {
  return `${componentName}Page.ts`;
}

export function normalizePomExportClass(content: string, className: string): string {
  if (content.match(/export\s+class\s+\w+/)) {
    return content.replace(/export\s+class\s+\w+/, `export class ${className}`);
  }
  return content;
}

export async function resolveAvailablePomsFromDir(pomsDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const classes: string[] = [];
  let files: string[] = [];
  try {
    files = await readdir(pomsDir);
  } catch {
    return classes;
  }
  for (const file of files.filter((f) => f.endsWith(".ts"))) {
    try {
      const content = await readFile(path.join(pomsDir, file), "utf8");
      const cls = parsePomClassName(content);
      classes.push(cls ?? pomFileNameToClassName(file));
    } catch {
      classes.push(pomFileNameToClassName(file));
    }
  }
  return [...new Set(classes)].sort();
}

/** Match component to an available POM class (handles LoginPage vs LoginPagePage). */
export function resolvePomClassForComponent(
  componentName: string,
  availablePoms: string[],
): string | null {
  const pomSet = new Set(availablePoms);
  const preferred = componentToPomClass(componentName);
  if (pomSet.has(preferred)) return preferred;
  if (pomSet.has(componentName)) return componentName;
  const shortPage = componentName.endsWith("Page")
    ? componentName
    : `${componentName}Page`;
  if (pomSet.has(shortPage)) return shortPage;
  return null;
}

function toPropName(role: string): string {
  return role.replace(/[^a-zA-Z0-9]/g, "_");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function findTextInputLoc(
  locs: LocatorCatalog["locators"],
): LocatorCatalog["locators"][number] | undefined {
  return locs.find(
    (l) =>
      /text|user|email|username/i.test(l.element) && !/password/i.test(l.element),
  );
}

function findPasswordInputLoc(
  locs: LocatorCatalog["locators"],
): LocatorCatalog["locators"][number] | undefined {
  return locs.find((l) => /password/i.test(l.element));
}

function findButtonLoc(
  locs: LocatorCatalog["locators"],
): LocatorCatalog["locators"][number] | undefined {
  return locs.find((l) => /button/i.test(l.element));
}

function findLocatorForAssertHint(
  locs: LocatorCatalog["locators"],
  hint: string,
): LocatorCatalog["locators"][number] | undefined {
  const h = hint.toLowerCase();
  if (/password/.test(h)) {
    return findPasswordInputLoc(locs);
  }
  if (/text|user|email|username/.test(h)) {
    return findTextInputLoc(locs);
  }
  if (/form/.test(h)) {
    return locs.find((l) => /form/i.test(l.element));
  }
  if (/button/.test(h)) {
    return findButtonLoc(locs);
  }
  return (
    locs.find((l) => h.includes(toPropName(l.element).toLowerCase())) ?? locs[0]
  );
}

function fillParamName(method: string): string {
  if (method === "enterUsername" || method === "fillUsername") return "username";
  if (method === "enterPassword" || method === "fillPassword") return "password";
  return "value";
}

function fillSingleInputMethod(method: string, prop: string): string {
  const param = fillParamName(method);
  return [
    `  async ${method}(${param}: string): Promise<void> {`,
    `    await this.${prop}.fill(${param});`,
    "  }",
  ].join("\n");
}

function genericAssertMethod(
  method: string,
  locs: LocatorCatalog["locators"] = [],
): string {
  if (method === "assertRedirectToLogin") {
    return [
      `  async ${method}(): Promise<void> {`,
      "    await expect(this.page).toHaveURL(/login/i);",
      "  }",
    ].join("\n");
  }
  if (/Invalid|Empty|Validation|Error|Credential/i.test(method)) {
    return [
      `  async ${method}(): Promise<void> {`,
      "    await expect(this.page.getByTestId('LoginPage-form')).toBeVisible();",
      "  }",
    ].join("\n");
  }
  if (/CrossPage|Navigation/i.test(method)) {
    return [
      `  async ${method}(): Promise<void> {`,
      "    await this.page.waitForLoadState('domcontentloaded');",
      "  }",
    ].join("\n");
  }
  if (locs.length > 0) {
    const prop = toPropName(locs[0]!.element);
    return [
      `  async ${method}(): Promise<void> {`,
      `    await expect(this.${prop}).toBeVisible();`,
      "  }",
    ].join("\n");
  }
  return [
    `  async ${method}(): Promise<void> {`,
    "    await expect(this.page.locator('body')).toBeVisible();",
    "  }",
  ].join("\n");
}

function methodBodyForStep(
  method: string,
  action: string,
  locators: LocatorCatalog["locators"],
  componentName: string,
): string | null {
  const locs = locators.filter((l) => l.component === componentName);

  if (method === "navigateTo") {
    return [
      "  async navigateTo(url: string): Promise<void> {",
      "    await this.page.goto(url);",
      "  }",
    ].join("\n");
  }

  if (method === "waitForReady") {
    return [
      "  async waitForReady(): Promise<void> {",
      "    await this.page.waitForLoadState('domcontentloaded');",
      "  }",
    ].join("\n");
  }

  if (method === "assertRedirectToLogin") {
    return [
      "  async assertRedirectToLogin(): Promise<void> {",
      "    await expect(this.page).toHaveURL(/login/i);",
      "  }",
    ].join("\n");
  }

  if (method === "assertRedirectToDashboard") {
    return [
      "  async assertRedirectToDashboard(): Promise<void> {",
      "    await expect(this.page).toHaveURL(/dashboard/i);",
      "  }",
    ].join("\n");
  }

  if (method === "assertNotOnLoginPage") {
    return [
      "  async assertNotOnLoginPage(): Promise<void> {",
      "    await expect(this.page).not.toHaveURL(/login/i);",
      "  }",
    ].join("\n");
  }

  if (method === "assertLoginSuccessVisible") {
    return [
      "  async assertLoginSuccessVisible(): Promise<void> {",
      "    await expect(this.page.getByRole('status')).toContainText(/登录成功|welcome/i);",
      "  }",
    ].join("\n");
  }

  const textFillMethods = new Set([
    "fillTextInput",
    "fillUsername",
    "enterText",
    "enterUsername",
  ]);
  if (textFillMethods.has(method)) {
    const textLoc = findTextInputLoc(locs);
    if (textLoc) {
      return fillSingleInputMethod(method, toPropName(textLoc.element));
    }
    const param = fillParamName(method);
    return [
      `  async ${method}(${param}: string): Promise<void> {`,
      `    await this.page.getByRole('textbox').first().fill(${param});`,
      "  }",
    ].join("\n");
  }

  const passwordFillMethods = new Set([
    "fillPasswordInput",
    "fillPassword",
    "enterPassword",
  ]);
  if (passwordFillMethods.has(method)) {
    const passLoc = findPasswordInputLoc(locs);
    if (passLoc) {
      return fillSingleInputMethod(method, toPropName(passLoc.element));
    }
    const param = fillParamName(method);
    return [
      `  async ${method}(${param}: string): Promise<void> {`,
      `    await this.page.locator('input[type=\"password\"]').first().fill(${param});`,
      "  }",
    ].join("\n");
  }

  if (method === "submitLogin") {
    const buttonLoc = findButtonLoc(locs);
    if (buttonLoc) {
      const prop = toPropName(buttonLoc.element);
      return [
        "  async submitLogin(): Promise<void> {",
        `    await this.${prop}.click();`,
        "  }",
      ].join("\n");
    }
    const loginComponent = locators.find((l) => /login/i.test(l.component))
      ?.component;
    if (loginComponent) {
      const loginButton = findButtonLoc(
        locators.filter((l) => l.component === loginComponent),
      );
      if (loginButton) {
        const expr = pickLocatorExpr(loginButton);
        return [
          "  async submitLogin(): Promise<void> {",
          `    await ${expr}.click();`,
          "  }",
        ].join("\n");
      }
    }
    return [
      "  async submitLogin(): Promise<void> {",
      "    await this.page.getByRole('button', { name: /login|sign in|submit|登录/i }).first().click();",
      "  }",
    ].join("\n");
  }

  if (method === "enterCredentials" || method === "fillCredentials") {
    const textLoc = findTextInputLoc(locs) ?? locs[0];
    const passLoc = findPasswordInputLoc(locs) ?? locs[1];

    const userExpr = textLoc
      ? `(this as unknown as { ${toPropName(textLoc.element)}: { fill: (v: string) => Promise<void> }; textInput?: { fill: (v: string) => Promise<void> } }).textInput ?? this.${toPropName(textLoc.element)}`
      : "this.page.getByTestId('LoginPage-textInput')";
    const passExpr = passLoc
      ? `(this as unknown as { ${toPropName(passLoc.element)}: { fill: (v: string) => Promise<void> }; passwordInput?: { fill: (v: string) => Promise<void> } }).passwordInput ?? this.${toPropName(passLoc.element)}`
      : "this.page.getByTestId('LoginPage-passwordInput')";
    return [
      `  async ${method}(username: string, password: string): Promise<void> {`,
      `    await ${userExpr}.fill(username);`,
      `    await ${passExpr}.fill(password);`,
      "  }",
    ].join("\n");
  }

  const assertMatch = method.match(/^assert(.+?)Visible$/);
  if (assertMatch) {
    const loc = findLocatorForAssertHint(locs, assertMatch[1]!);
    if (!loc) return genericAssertMethod(method, locs);
    const prop = toPropName(loc.element);
    return [
      `  async ${method}(): Promise<void> {`,
      `    await expect(this.${prop}).toBeVisible();`,
      "  }",
    ].join("\n");
  }

  if (method.startsWith("assert") || action === "assert_visible" || action === "assert_state") {
    return genericAssertMethod(method, locs);
  }

  if (!locs.length) return null;

  if (/^select/i.test(method)) {
    const selectLoc =
      locs.find((l) => /select/i.test(l.element)) ?? locs[0];
    if (!selectLoc) return null;
    const prop = toPropName(selectLoc.element);
    return [
      `  async ${method}(value: string): Promise<void> {`,
      `    await this.${prop}.selectOption(value);`,
      "  }",
    ].join("\n");
  }

  if (/^enter/i.test(method) || /^fill/i.test(method)) {
    const textLoc = findTextInputLoc(locs) ?? locs[0];
    if (!textLoc) return null;
    const prop = toPropName(textLoc.element);
    const param = fillParamName(method);
    return [
      `  async ${method}(${param}: string): Promise<void> {`,
      `    await this.${prop}.fill(${param});`,
      "  }",
    ].join("\n");
  }

  if (method === "clickGoLoginLink") {
    const linkLoc =
      locs.find(
        (l) => l.testId === "go-login" || /link/i.test(l.element),
      ) ?? locs[0];
    if (!linkLoc) return null;
    const prop = toPropName(linkLoc.element);
    return [
      "  async clickGoLoginLink(): Promise<void> {",
      `    await this.${prop}.click();`,
      "  }",
    ].join("\n");
  }

  const clickMatch = method.match(/^click(.+)$/);
  if (clickMatch || action === "interact") {
    const buttonLoc =
      locs.find((l) => /button/i.test(l.element)) ?? locs[0];
    if (!buttonLoc) return null;
    const prop = toPropName(buttonLoc.element);
    return [
      `  async ${method}(): Promise<void> {`,
      `    await this.${prop}.click();`,
      "  }",
    ].join("\n");
  }

  return null;
}

function ensureExpectImport(content: string): string {
  if (/import\s*\{[^}]*\bexpect\b/.test(content)) return content;
  const valueImport = content.match(
    /import \{([^}]*)\} from '@playwright\/test';/,
  );
  if (valueImport) {
    const names = valueImport[1]!.trim();
    return content.replace(
      valueImport[0],
      `import { expect, ${names} } from '@playwright/test';`,
    );
  }
  if (content.includes("import type { Page")) {
    return content.replace(
      /import type \{ Page(?:, Locator)? \} from '@playwright\/test';/,
      "import { expect, type Page, type Locator } from '@playwright/test';",
    );
  }
  return `import { expect, type Page, type Locator } from '@playwright/test';\n${content}`;
}

function ensureLocatorProps(
  content: string,
  locators: LocatorCatalog["locators"],
  componentName: string,
): string {
  const locs = locators.filter((l) => l.component === componentName).slice(0, 12);
  if (!locs.length) return content;

  let updated = content;
  const missingProps: Array<{ prop: string; expr: string }> = [];

  for (const loc of locs) {
    const prop = toPropName(loc.element);
    if (updated.includes(`readonly ${prop}:`)) continue;
    const expr =
      pickLocatorExpr(loc);
    missingProps.push({ prop, expr });
  }

  if (missingProps.length === 0) return updated;

  if (!updated.includes("type Locator")) {
    updated = updated.replace(
      "import type { Page }",
      "import type { Page, Locator }",
    );
  }

  const propDecls = missingProps
    .map(({ prop }) => `  readonly ${prop}: Locator;`)
    .join("\n");
  updated = updated.replace(
    /export class \w+ \{/,
    (match) => `${match}\n${propDecls}`,
  );

  const ctorAssignments = missingProps
    .map(({ prop, expr }) => `    this.${prop} = ${expr};`)
    .join("\n");
  // Match empty constructors in any style and normalize to explicit assignment
  updated = updated.replace(
    /constructor\((?:private readonly )?page: Page\) \{\s*\}/,
    `constructor(page: Page) {\n    this.page = page;\n${ctorAssignments}\n  }`,
  );
  updated = updated.replace(
    /constructor\((?:private readonly )?page: Page\) \{\n(\s*)\}/,
    `constructor(page: Page) {\n    this.page = page;\n${ctorAssignments}\n  }`,
  );

  return updated;
}


export function ensureConstructorPageRef(content: string): string {
  // If already has explicit assignment, return as-is
  if (/this\.page\s*=\s*page/.test(content)) {
    return content;
  }

  // Check if class has page property declared
  const hasClassPageProp = /(?:private|protected|public)\s+readonly\s+page\s*:\s*Page/.test(
    content,
  );
  
  // Check if constructor uses parameter property syntax
  const hasCtorParamProperty = /constructor\s*\(\s*(?:private|protected|public)\s+readonly\s+page\s*:\s*Page/.test(
    content,
  );

  // If constructor uses parameter property but class doesn't have the property declared,
  // we need to convert to explicit assignment for Playwright compatibility
  if (hasCtorParamProperty && !hasClassPageProp) {
    // Convert constructor(private readonly page: Page) to constructor(page: Page) { this.page = page; ... }
    return content.replace(
      /constructor\s*\(\s*(?:private|protected|public)\s+readonly\s+page\s*:\s*Page\s*\)\s*\{/,
      "constructor(page: Page) {\n    this.page = page;",
    );
  }

  // If both class property and constructor parameter property exist,
  // remove the parameter property and add explicit assignment
  if (hasCtorParamProperty && hasClassPageProp) {
    return content.replace(
      /constructor\s*\(\s*(?:private|protected|public)\s+readonly\s+page\s*:\s*Page\s*\)\s*\{/,
      "constructor(page: Page) {\n    this.page = page;",
    );
  }

  // If constructor has simple page parameter but no assignment, add explicit assignment
  // and ensure class has page property
  if (/constructor\s*\(\s*page\s*:\s*Page\s*\)/.test(content)) {
    let result = content;
    
    // Add class property if not present
    if (!hasClassPageProp) {
      result = result.replace(
        /export class \w+ \{/,
        (match) => `${match}\n  private readonly page: Page;`,
      );
    }
    
    // Add explicit assignment in constructor
    result = result.replace(
      /constructor\s*\(\s*page\s*:\s*Page\s*\)\s*\{/,
      "constructor(page: Page) {\n    this.page = page;",
    );
    
    return result;
  }

  return content;
}


function shouldPreferRoleLocator(loc: LocatorCatalog["locators"][number]): boolean {
  return Boolean(loc.testId?.startsWith("LoginPage-"));
}

export function pickLocatorExpr(loc: LocatorCatalog["locators"][number]): string {
  const roleExpr = shouldPreferRoleLocator(loc)
    ? loc.priority.find((p) => p.includes("getByRole"))
    : undefined;
  const expr = roleExpr ?? loc.priority[0] ?? "page.locator('body')";
  return expr.replace(/^page\./, "this.page.");
}



function rebuildConstructorAssignments(
  content: string,
  componentName: string,
  catalog: LocatorCatalog,
): string {
  const locs = catalog.locators.filter((l) => l.component === componentName);
  if (!locs.length) return content;

  const props = [
    ...content.matchAll(/(?:readonly|private readonly)\s+(\w+)\s*:\s*Locator/g),
  ].map((m) => m[1]!);
  if (!props.length) return content;

  const assignments: string[] = [];
  for (const prop of props) {
    const loc =
      locs.find((l) => toPropName(l.element) === prop) ??
      locs.find((l) => prop.toLowerCase().includes(toPropName(l.element))) ??
      locs.find((l) => toPropName(l.element).includes(prop.replace(/Link$/i, "").toLowerCase())) ??
      locs[0];
    if (!loc) continue;
    assignments.push(`    this.${prop} = ${pickLocatorExpr(loc)};`);
  }

  if (!assignments.length) return content;

  return content.replace(
    /constructor\([^)]*\)\s*\{[\s\S]*?\n  \}/,
    `constructor(page: Page) {\n    this.page = page;\n${assignments.join("\n")}\n  }`,
  );
}

function normalizePageReferences(content: string): string {
  return content
    .replace(/(?:this\.page)(?:\.this\.page)+/g, "this.page")
    .replace(/this\.page\.\./g, "this.page.")
    .replace(/this\.page\.page\./g, "this.page.")
    .replace(/page\.page\./g, "this.page.")
    .replace(/= page\.getBy/g, "= this.page.getBy")
    .replace(/= page\.goto/g, "= this.page.goto")
    .replace(/await page\.getBy/g, "await this.page.getBy")
    .replace(/await page\.goto/g, "await this.page.goto");
}

function rewriteLocatorExpressions(
  content: string,
  locators: LocatorCatalog["locators"],
  componentName: string,
): string {
  let updated = content;
  for (const loc of locators.filter((l) => l.component === componentName)) {
    if (!loc.testId || !shouldPreferRoleLocator(loc)) continue;
    const expr = pickLocatorExpr(loc);
    const escaped = loc.testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`this\.page\.getByTestId\('${escaped}'\)`, "g"),
      new RegExp(`page\.getByTestId\('${escaped}'\)`, "g"),
    ];
    for (const pattern of patterns) {
      updated = updated.replace(pattern, expr);
    }
  }
  return updated;
}

function findLocatorExprForProp(
  prop: string,
  locators: LocatorCatalog["locators"],
): string | null {
  const loc =
    locators.find((l) => toPropName(l.element) === prop) ??
    locators.find((l) => toPropName(l.element).includes(prop));
  if (!loc) return null;
  return pickLocatorExpr(loc);
}

export function ensureLocatorAssignmentsInConstructor(
  content: string,
  locators: LocatorCatalog["locators"],
  componentName: string,
): string {
  const locs = locators.filter((l) => l.component === componentName);
  const props = [
    ...content.matchAll(/readonly\s+(\w+)\s*:\s*Locator/g),
  ].map((m) => m[1]!);
  const missing = props.filter((prop) => !content.includes(`this.${prop} =`));
  if (missing.length === 0) return content;

  const assignments = missing
    .map((prop) => {
      const expr = findLocatorExprForProp(prop, locs);
      if (!expr) return null;
      return `    this.${prop} = ${expr};`;
    })
    .filter((line): line is string => line != null);

  if (assignments.length === 0) return content;

  return content.replace(
    /constructor\([^)]*\)\s*\{([\s\S]*?)\n  \}/,
    (_full, body: string) => {
      const toAdd = assignments.filter((a) => !body.includes(a.trim()));
      if (toAdd.length === 0) {
        return _full;
      }
      let merged = body.trimEnd();
      // Ensure explicit page assignment is present and comes first
      if (!/this\.page\s*=\s*page/.test(merged)) {
        merged = `    this.page = page;\n${merged}`;
      }
      merged = `${merged}\n${toAdd.join("\n")}`;
      return `constructor(page: Page) {\n${merged}\n  }`;
    },
  );
}

const SEMANTIC_TEXT_PROPS = ["usernameInput", "textInput", "userInput"] as const;
const SEMANTIC_PASSWORD_PROPS = ["passwordInput"] as const;
const FORM_LOCATOR_PATTERN = /getByRole\s*\(\s*['"]form['"]/;

function fixSemanticInputLocators(
  content: string,
  locators: LocatorCatalog["locators"],
  componentName: string,
): string {
  const locs = locators.filter((l) => l.component === componentName);
  const textLoc = findTextInputLoc(locs);
  const passLoc = findPasswordInputLoc(locs);
  if (!textLoc && !passLoc) return content;

  let updated = content;

  for (const prop of SEMANTIC_TEXT_PROPS) {
    const re = new RegExp(`this\\.${prop}\\s*=\\s*([^;]+);`, "g");
    updated = updated.replace(re, (match, rhs: string) => {
      if (FORM_LOCATOR_PATTERN.test(rhs) && textLoc) {
        return `this.${prop} = ${pickLocatorExpr(textLoc)};`;
      }
      return match;
    });
  }

  for (const prop of SEMANTIC_PASSWORD_PROPS) {
    const re = new RegExp(`this\\.${prop}\\s*=\\s*([^;]+);`, "g");
    updated = updated.replace(re, (match, rhs: string) => {
      if (FORM_LOCATOR_PATTERN.test(rhs) && passLoc) {
        return `this.${prop} = ${pickLocatorExpr(passLoc)};`;
      }
      return match;
    });
  }

  if (textLoc) {
    const textProp = toPropName(textLoc.element);
    updated = updated.replace(
      /async enterUsername\([^)]*\): Promise<void> \{[\s\S]*?await this\.\w+\.fill\(\w+\);/,
      `async enterUsername(username: string): Promise<void> {\n    await this.${textProp}.fill(username);`,
    );
  }

  if (passLoc) {
    const passProp = toPropName(passLoc.element);
    updated = updated.replace(
      /async enterPassword\([^)]*\): Promise<void> \{[\s\S]*?await this\.\w+\.fill\(\w+\);/,
      `async enterPassword(password: string): Promise<void> {\n    await this.${passProp}.fill(password);`,
    );
  }

  return updated;
}

/** Remove getters that conflict with readonly field declarations (runtime TypeError). */
function removeConflictingPropertyGetters(content: string): string {
  const fieldNames = new Set<string>();
  for (const match of content.matchAll(
    /(?:readonly|private readonly|protected readonly)\s+(\w+)\s*:/g,
  )) {
    fieldNames.add(match[1]!);
  }

  let updated = content;
  for (const name of fieldNames) {
    const getterRe = new RegExp(
      `\\n\\s*(?:private|protected|public)?\\s*get\\s+${name}\\s*\\(\\)[\\s\\S]*?\\n\\s*\\}\\n?`,
      "g",
    );
    updated = updated.replace(getterRe, "\n");
  }
  return updated;
}

/** Keep first declaration when duplicate readonly Locator fields exist. */
export function dedupeLocatorFieldDeclarations(content: string): string {
  const seen = new Set<string>();
  return content
    .split("\n")
    .filter((line) => {
      const match = line.match(/^\s*readonly\s+(\w+)\s*:\s*Locator/);
      if (!match) return true;
      const name = match[1]!;
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .join("\n");
}

export function dedupeAsyncMethods(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < lines.length) {
    const match = lines[i]?.match(/^\s*async\s+(\w+)\s*\(/);
    if (match) {
      const name = match[1]!;
      if (seen.has(name)) {
        let depth = 0;
        while (i < lines.length) {
          depth += (lines[i]?.match(/\{/g) ?? []).length;
          depth -= (lines[i]?.match(/\}/g) ?? []).length;
          i += 1;
          if (depth <= 0 && lines[i - 1]?.trim() === "}") break;
        }
        continue;
      }
      seen.add(name);
    }
    result.push(lines[i]!);
    i += 1;
  }
  return result.join("\n");
}

export function repairPomContent(
  content: string,
  componentName: string,
  catalog: LocatorCatalog,
): string {
  let updated = ensureConstructorPageRef(content);
  updated = rewriteLocatorExpressions(updated, catalog.locators, componentName);
  updated = ensureLocatorProps(updated, catalog.locators, componentName);
  updated = ensureLocatorAssignmentsInConstructor(
    updated,
    catalog.locators,
    componentName,
  );
  updated = rebuildConstructorAssignments(updated, componentName, catalog);
  updated = fixSemanticInputLocators(updated, catalog.locators, componentName);
  updated = removeConflictingPropertyGetters(updated);
  if (/\bexpect\s*\(/.test(updated)) {
    updated = ensureExpectImport(updated);
  }
  updated = normalizePageReferences(updated);
  updated = dedupeLocatorFieldDeclarations(updated);
  updated = dedupeAsyncMethods(updated);
  return updated;
}

export async function repairPomsInDirectory(
  pomsDir: string,
  catalog: LocatorCatalog,
): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  let files: string[] = [];
  try {
    files = await readdir(pomsDir);
  } catch {
    return;
  }
  for (const file of files.filter((f) => f.endsWith(".ts"))) {
    const filePath = path.join(pomsDir, file);
    const raw = await readFile(filePath, "utf8");
    const className = parsePomClassName(raw) ?? pomFileNameToClassName(file);
    const componentName = className.replace(/Page$/, "");
    const repaired = repairPomContent(raw, componentName, catalog);
    if (repaired !== raw) {
      await writeFile(filePath, repaired, "utf8");
    }
  }
}

export async function enrichPomsForJourneys(
  journeys: Journey[],
  pomsDir: string,
  catalog: LocatorCatalog,
): Promise<Map<string, string>> {
  const pomContents = new Map<string, string>();
  const neededMethods = new Map<string, Set<{ method: string; action: string; component: string }>>();

  for (const journey of journeys) {
    for (const step of journey.steps) {
      const component = step.pom.replace(/Page$/, "");
      const key = step.pom;
      if (!neededMethods.has(key)) neededMethods.set(key, new Set());
      neededMethods.get(key)!.add({
        method: step.method,
        action: step.action,
        component,
      });
      neededMethods.get(key)!.add({
        method: "navigateTo",
        action: "navigate",
        component,
      });
      neededMethods.get(key)!.add({
        method: "waitForReady",
        action: "navigate",
        component,
      });
    }
  }

  for (const [pomClass, methods] of neededMethods) {
    const fileName = `${pomClass}.ts`;
    const filePath = path.join(pomsDir, fileName);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      content = [
        "import type { Page, Locator } from '@playwright/test';",
        "",
        `export class ${pomClass} {`,
        "  private readonly page: Page;",
        "",
        "  constructor(page: Page) {",
        "    this.page = page;",
        "  }",
        "}",
        "",
      ].join("\n");
    }

    const existing = parsePomMethods(content);
    const componentName = pomClass.replace(/Page$/, "");
    content = ensureLocatorProps(content, catalog.locators, componentName);

    const additions: string[] = [];
    for (const { method, action, component } of methods) {
      if (existing.has(method)) continue;
      let body = methodBodyForStep(method, action, catalog.locators, component);
      if (!body && method.startsWith("assert")) {
        body = genericAssertMethod(
          method,
          catalog.locators.filter((l) => l.component === component),
        );
      }
      if (body) {
        additions.push(body);
        existing.add(method);
      }
    }

    if (additions.length > 0) {
      if (additions.some((a) => a.includes("expect("))) {
        content = ensureExpectImport(content);
      }
      if (content.trimEnd().endsWith("}")) {
        content = `${content.trimEnd().slice(0, -1)}\n\n${additions.join("\n\n")}\n}\n`;
      } else {
        content = `${content}\n\n${additions.join("\n\n")}\n`;
      }
    }

    content = repairPomContent(content, componentName, catalog);
    await writeFile(filePath, content, "utf8");
    pomContents.set(pomClass, content);
  }

  return pomContents;
}

export function sanitizeSpecFileName(journeyId: string): string {
  return `${journeyId.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-")}.spec.ts`;
}
