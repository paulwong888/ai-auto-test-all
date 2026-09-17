import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Journey } from "../artifacts/types.js";
import { buildDeterministicSpec } from "./assistant-director.js";

describe("buildDeterministicSpec", () => {
  it("uses E2E env vars for credential steps when e2eAuth is provided", () => {
    const journey: Journey = {
      id: "login",
      name: "Login",
      gherkinText: "Scenario: login",
      steps: [
        {
          step: 1,
          action: "interact",
          pom: "LoginPagePage",
          method: "enterUsername",
          args: ["admin"],
        },
        {
          step: 2,
          action: "interact",
          pom: "LoginPagePage",
          method: "enterPassword",
          args: ["123456"],
        },
      ],
    };

    const spec = buildDeterministicSpec(
      journey,
      "http://localhost/",
      new Map([["LoginPagePage", new Set(["enterUsername", "enterPassword"])]]),
      { username: "admin", password: "123456" },
    );

    assert.match(spec, /enterUsername\(process\.env\.E2E_USERNAME!\)/);
    assert.match(spec, /enterPassword\(process\.env\.E2E_PASSWORD!\)/);
    assert.doesNotMatch(spec, /validUser/);
  });
});
