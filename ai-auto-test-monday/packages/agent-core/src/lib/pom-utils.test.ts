import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LocatorCatalog } from "../artifacts/types.js";
import {
  dedupeAsyncMethods,
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
