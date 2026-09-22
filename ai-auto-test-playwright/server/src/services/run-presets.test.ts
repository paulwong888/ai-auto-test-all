import { describe, expect, it } from "vitest";
import { effectiveVncPreview, resolveRunOptions } from "./run-presets.js";

describe("resolveRunOptions", () => {
  it("debug preset enables vnc preview and headed", () => {
    const r = resolveRunOptions({ preset: "debug" });
    expect(r.headed).toBe(true);
    expect(r.vncPreview).toBe(true);
    expect(effectiveVncPreview(r)).toBe(true);
  });

  it("ci preset disables vnc preview", () => {
    const r = resolveRunOptions({ preset: "ci" });
    expect(r.headed).toBe(false);
    expect(r.vncPreview).toBe(false);
    expect(effectiveVncPreview(r)).toBe(false);
  });

  it("custom defaults vnc preview off", () => {
    const r = resolveRunOptions({ preset: "custom", headed: true });
    expect(r.vncPreview).toBe(false);
    expect(effectiveVncPreview(r)).toBe(false);
  });

  it("custom can enable vnc preview when headed", () => {
    const r = resolveRunOptions({ preset: "custom", headed: true, vncPreview: true });
    expect(effectiveVncPreview(r)).toBe(true);
  });

  it("vnc preview ignored when headless", () => {
    const r = resolveRunOptions({ preset: "custom", headed: false, vncPreview: true });
    expect(effectiveVncPreview(r)).toBe(false);
  });

  it("ci ignores explicit vncPreview true", () => {
    const r = resolveRunOptions({ preset: "ci", vncPreview: true });
    expect(r.vncPreview).toBe(false);
  });
});
