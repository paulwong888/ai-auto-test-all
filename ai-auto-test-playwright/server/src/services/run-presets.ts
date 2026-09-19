import type { RunPreset } from "../repositories/run-repository.js";

export const RUN_PRESETS = {
  debug: { headed: true, slowmo: 600 },
  ci: { headed: false, slowmo: 0 },
} as const;

export interface RunRequestBody {
  preset?: "debug" | "ci" | "custom";
  headed?: boolean;
  slowmo?: number;
  specFilter?: string | null;
  nodeIds?: string[];
  rerunFailedOnly?: boolean;
  previousRunId?: string | null;
}

export interface ResolvedRunOptions {
  preset: RunPreset;
  headed: boolean;
  slowmo: number;
  specFilter: string | null;
  nodeIds: string[];
  parentRunId: string | null;
}

export function resolveRunOptions(body: RunRequestBody): ResolvedRunOptions {
  if (body.preset && body.preset !== "custom") {
    const preset = RUN_PRESETS[body.preset];
    return {
      preset: body.preset,
      headed: preset.headed,
      slowmo: preset.slowmo,
      specFilter: body.specFilter ?? null,
      nodeIds: body.nodeIds ?? [],
      parentRunId: body.previousRunId ?? null,
    };
  }
  return {
    preset: body.preset === "custom" ? "custom" : null,
    headed: body.headed ?? true,
    slowmo: body.slowmo ?? 600,
    specFilter: body.specFilter ?? null,
    nodeIds: body.nodeIds ?? [],
    parentRunId: body.previousRunId ?? null,
  };
}
