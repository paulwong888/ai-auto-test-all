import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import {
  buildPlaywrightTestCommand,
  isPlaywrightSpecCommand,
  shellQuote,
} from "./playwright-runner.js";

describe("playwright-runner", () => {
  it("shellQuote escapes single quotes", () => {
    assert.equal(shellQuote("a'b"), "'a'\\''b'");
  });

  it("buildPlaywrightTestCommand uses NODE_PATH and config path", () => {
    const cmd = buildPlaywrightTestCommand(
      config,
      "/data/repos/app",
      "http://172.26.9.212:8026",
      "tests/e2e/foo.spec.ts",
    );
    assert.match(cmd, /cd '\/data\/repos\/app'/);
    assert.match(cmd, /NODE_PATH=/);
    assert.match(cmd, /PLAYWRIGHT_BASE_URL='http:\/\/172\.26\.9\.212:8026'/);
    assert.match(cmd, /playwright\.config\.ts tests\/e2e\/foo\.spec\.ts/);
    assert.match(cmd, /\.env\.e2e/);
    assert.match(cmd, /true;/);
  });

  it("isPlaywrightSpecCommand matches cli.js and npx forms", () => {
    const spec = "tests/e2e/foo.spec.ts";
    assert.ok(
      isPlaywrightSpecCommand(
        "node /app/sandbox-repos/demo-app/node_modules/@playwright/test/cli.js test " + spec,
        spec,
      ),
    );
    assert.ok(isPlaywrightSpecCommand(`npx playwright test ${spec}`, spec));
    assert.ok(!isPlaywrightSpecCommand("npm install @playwright/test", spec));
  });
});
