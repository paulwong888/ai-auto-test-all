import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Journey, LocatorCatalog } from "../artifacts/types.js";
import {
  dedupeAsyncMethods,
  dedupeLocatorFieldDeclarations,
  enrichPomsForJourneys,
  ensureConstructorPageRef,
  repairPomContent,
} from "./pom-utils.js";

const catalog: LocatorCatalog = {
  generatedAt: "2026-09-14T00:00:00.000Z",
  locators: [
    {
      component: "HomePage",
      element: "link",
      testId: "go-login",
      priority: ["page.getByTestId('go-login')"],
    },
  ],
};

describe("repairPomContent", () => {
  it("stores page ref and initializes readonly locators", () => {
    const broken = `import { Page, Locator } from '@playwright/test';

export class HomePagePage {
  readonly link: Locator;

  constructor(page: Page) {
    this.goLoginLink = page.getByTestId('go-login');
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }
}
`;
    const fixed = repairPomContent(broken, "HomePage", catalog);
    assert.match(fixed, /this\.page = page;/);
    assert.match(fixed, /private readonly page: Page;/);
    assert.match(fixed, /this\.link = this\.page\.getByTestId\('go-login'\)/);
    assert.ok(!fixed.includes("constructor(private readonly page: Page)"));
  });

  it("normalizes parameter property constructors to explicit assignment", () => {
    const input = `import { expect, Page, Locator } from '@playwright/test';

export class HomePagePage {
  readonly link: Locator;
  private readonly page: Page;

  constructor(private readonly page: Page) {
    this.link = this.page.getByTestId('go-login');
  }
}
`;
    const fixed = repairPomContent(input, "HomePage", catalog);
    assert.match(fixed, /constructor\(page: Page\) \{\n    this\.page = page;/);
    assert.ok(!fixed.includes("constructor(private readonly page: Page)"));
  });

  it("dedupes duplicate async methods", () => {
    const duped = dedupeAsyncMethods(`class X {
  async foo(): Promise<void> {
    await this.page.goto('/');
  }

  async foo(): Promise<void> {
    await this.page.goto('/other');
  }
}
`);
    assert.equal((duped.match(/async foo\(/g) ?? []).length, 1);
  });
});

describe("ensureConstructorPageRef", () => {
  it("adds explicit page assignment for plain page param", () => {
    const out = ensureConstructorPageRef(
      "export class FooPage {\n  constructor(page: Page) {}\n}",
    );
    assert.match(out, /constructor\(page: Page\) \{\n    this\.page = page;/);
    assert.match(out, /private readonly page: Page;/);
    assert.ok(!out.includes("constructor(private readonly page: Page)"));
  });

  it("converts parameter property to explicit assignment", () => {
    const input = `export class FooPage {
  readonly link: Locator;
  private readonly page: Page;

  constructor(private readonly page: Page) {
    this.link = this.page.getByTestId('x');
  }
}`;
    const out = ensureConstructorPageRef(input);
    assert.ok(out.includes("constructor(page: Page)"));
    assert.ok(out.includes("this.page = page;"));
    assert.ok(!out.includes("constructor(private readonly page: Page)"));
  });

  it("leaves explicit assignment untouched", () => {
    const input = `export class FooPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }
}`;
    const out = ensureConstructorPageRef(input);
    assert.equal(out, input);
  });
});

const loginCatalog: LocatorCatalog = {
  generatedAt: "2026-09-15T00:00:00.000Z",
  locators: [
    {
      component: "LoginPage",
      element: "text-input",
      testId: "LoginPage-textInput",
      priority: [
        "page.getByRole('textbox', { name: '用户名' })",
        "page.getByTestId('LoginPage-textInput')",
      ],
    },
    {
      component: "LoginPage",
      element: "password-input",
      testId: "LoginPage-passwordInput",
      priority: [
        "page.getByRole('textbox', { name: '密码' })",
        "page.getByTestId('LoginPage-passwordInput')",
      ],
    },
    {
      component: "LoginPage",
      element: "button",
      testId: "LoginPage-button",
      priority: ["page.getByRole('button', { name: '登录按钮' })"],
    },
    {
      component: "LoginPage",
      element: "form",
      testId: "LoginPage-form",
      priority: ["page.getByRole('form', { name: '登录表单' })"],
    },
  ],
};

describe("enrichPomsForJourneys fill methods", () => {
  let pomsDir: string;

  beforeEach(async () => {
    pomsDir = await mkdtemp(path.join(os.tmpdir(), "pom-enrich-"));
  });

  afterEach(async () => {
    await rm(pomsDir, { recursive: true, force: true });
  });

  it("adds fillTextInput and fillPasswordInput from journey steps", async () => {
    const journeys: Journey[] = [
      {
        id: "login-test",
        name: "Login test",
        description: "test",
        priority: "P1",
        category: "Happy Path",
        gherkinText: "Scenario: login",
        steps: [
          {
            step: 1,
            action: "interact",
            pom: "LoginPagePage",
            method: "fillTextInput",
            args: ["user@example.com"],
            description: "fill username",
          },
          {
            step: 2,
            action: "interact",
            pom: "LoginPagePage",
            method: "fillPasswordInput",
            args: ["secret"],
            description: "fill password",
          },
        ],
      },
    ];

    await enrichPomsForJourneys(journeys, pomsDir, loginCatalog);
    const pom = await readFile(path.join(pomsDir, "LoginPagePage.ts"), "utf8");
    assert.match(pom, /async fillTextInput\(value: string\)/);
    assert.match(pom, /await this\.text_input\.fill\(value\)/);
    assert.match(pom, /async fillPasswordInput\(value: string\)/);
    assert.match(pom, /await this\.password_input\.fill\(value\)/);
  });
});

describe("removeConflictingPropertyGetters via repairPomContent", () => {
  it("strips getter when readonly field with same name exists", () => {
    const broken = `import type { Page, Locator } from '@playwright/test';

export class LoginPagePage {
  readonly form: Locator;
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.form = this.page.getByRole('form', { name: '登录表单' });
  }

  private get form(): Locator {
    return this.page.getByTestId('LoginPage-form');
  }
}
`;
    const fixed = repairPomContent(broken, "LoginPage", loginCatalog);
    assert.ok(!fixed.includes("get form()"));
    assert.match(fixed, /readonly form: Locator/);
  });
});

describe("fixSemanticInputLocators via repairPomContent", () => {
  it("reassigns usernameInput from form to textbox locator", () => {
    const broken = `import type { Page, Locator } from '@playwright/test';

export class LoginPagePage {
  private readonly usernameInput: Locator;
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = this.page.getByRole('form', { name: '登录表单' });
  }

  async enterUsername(username: string): Promise<void> {
    await this.usernameInput.fill(username);
  }
}
`;
    const fixed = repairPomContent(broken, "LoginPage", loginCatalog);
    assert.match(fixed, /this\.usernameInput = this\.page\.getByRole\('textbox'/);
    assert.match(fixed, /await this\.text_input\.fill\(username\)/);
  });
});

describe("dedupeLocatorFieldDeclarations", () => {
  it("removes duplicate readonly Locator fields", () => {
    const input = `export class X {
  readonly button: Locator;
  readonly link: Locator;
  readonly button: Locator;
}`;
    const out = dedupeLocatorFieldDeclarations(input);
    assert.equal((out.match(/readonly button: Locator/g) ?? []).length, 1);
    assert.match(out, /readonly link: Locator/);
  });
});

describe("enrichPomsForJourneys journey method names", () => {
  let pomsDir: string;

  beforeEach(async () => {
    pomsDir = await mkdtemp(path.join(os.tmpdir(), "pom-method-"));
  });

  afterEach(async () => {
    await rm(pomsDir, { recursive: true, force: true });
  });

  it("uses exact journey step method name for interact actions", async () => {
    const catalog: LocatorCatalog = {
      generatedAt: "2026-09-16T00:00:00.000Z",
      locators: [
        {
          component: "HoldSuspension",
          element: "button",
          testId: "HoldSuspension-button",
          priority: ["page.getByTestId('HoldSuspension-button')"],
        },
      ],
    };
    const journeys: Journey[] = [
      {
        id: "hold",
        name: "Hold",
        description: "hold",
        priority: "P1",
        category: "Happy Path",
        gherkinText: "Scenario: hold",
        steps: [
          {
            step: 1,
            pom: "HoldSuspensionPage",
            method: "selectSuspensionReason",
            action: "interact",
            description: "select reason",
          },
        ],
      },
    ];
    await enrichPomsForJourneys(journeys, pomsDir, catalog);
    const content = await readFile(
      path.join(pomsDir, "HoldSuspensionPage.ts"),
      "utf8",
    );
    assert.match(content, /async selectSuspensionReason\(/);
    assert.doesNotMatch(content, /selectHoldSuspensionOption/);
  });

  it("adds enterUsername/enterPassword fallbacks when catalog lacks inputs", async () => {
    const catalog: LocatorCatalog = {
      generatedAt: "2026-09-16T00:00:00.000Z",
      locators: [
        {
          component: "WaivingForm",
          element: "form",
          testId: "WaivingForm-form",
          priority: ["page.getByTestId('WaivingForm-form')"],
        },
        {
          component: "WaivingForm",
          element: "button",
          testId: "WaivingForm-button",
          priority: ["page.getByTestId('WaivingForm-button')"],
        },
      ],
    };
    const journeys: Journey[] = [
      {
        id: "complete-waiving-request",
        name: "Complete waiving",
        description: "waiving",
        priority: "P1",
        category: "Happy Path",
        gherkinText: "Scenario: waiving",
        steps: [
          {
            step: 1,
            pom: "WaivingFormPage",
            method: "enterUsername",
            action: "interact",
            description: "enter username",
          },
          {
            step: 2,
            pom: "WaivingFormPage",
            method: "enterPassword",
            action: "interact",
            description: "enter password",
          },
        ],
      },
    ];
    await enrichPomsForJourneys(journeys, pomsDir, catalog);
    const content = await readFile(
      path.join(pomsDir, "WaivingFormPage.ts"),
      "utf8",
    );
    assert.match(content, /async enterUsername\(/);
    assert.match(content, /getByRole\('textbox'\)/);
    assert.match(content, /async enterPassword\(/);
    assert.match(content, /input\[type="password"\]/);
  });

  it("generates post-login assert methods with explicit URL/status checks", async () => {
    const loginCatalog: LocatorCatalog = {
      generatedAt: "2026-09-16T00:00:00.000Z",
      locators: [],
    };
    const journeys: Journey[] = [
      {
        id: "login-success",
        name: "Login success",
        gherkinText: "Scenario: login",
        steps: [
          {
            step: 1,
            action: "assert_state",
            pom: "LoginPagePage",
            method: "assertRedirectToDashboard",
          },
          {
            step: 2,
            action: "assert_visible",
            pom: "LoginPagePage",
            method: "assertLoginSuccessVisible",
          },
        ],
      },
    ];
    await enrichPomsForJourneys(journeys, pomsDir, loginCatalog);
    const content = await readFile(
      path.join(pomsDir, "LoginPagePage.ts"),
      "utf8",
    );
    assert.match(content, /toHaveURL\(\/dashboard/i);
    assert.match(content, /getByRole\('status'\)/);
  });
});
