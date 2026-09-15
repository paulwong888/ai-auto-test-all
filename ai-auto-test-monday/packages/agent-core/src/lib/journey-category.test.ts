import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeJourneyCategory } from "./journey-category.js";

describe("normalizeJourneyCategory", () => {
  it("keeps valid categories unchanged", () => {
    assert.equal(normalizeJourneyCategory("Happy Path"), "Happy Path");
    assert.equal(normalizeJourneyCategory("Cross-Page"), "Cross-Page");
  });

  it("maps common LLM aliases", () => {
    assert.equal(normalizeJourneyCategory("authentication"), "Happy Path");
    assert.equal(normalizeJourneyCategory("navigation"), "Cross-Page");
    assert.equal(normalizeJourneyCategory("error"), "Error Handling");
  });

  it("defaults unknown values to Happy Path", () => {
    assert.equal(normalizeJourneyCategory("something-random"), "Happy Path");
  });

  it("returns undefined for empty input", () => {
    assert.equal(normalizeJourneyCategory(undefined), undefined);
    assert.equal(normalizeJourneyCategory(""), undefined);
  });
});
