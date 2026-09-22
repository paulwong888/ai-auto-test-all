import type { RunPreset } from "../repositories/run-repository.js";

export const RUN_PRESETS = {
  debug: { headed: true, slowmo: 600, vncPreview: true },
  ci: { headed: false, slowmo: 0, vncPreview: false },
} as const;

export interface RunRequestBody {
  preset?: "debug" | "ci" | "custom";
  headed?: boolean;
  slowmo?: number;
  vncPreview?: boolean;
  specFilter?: string | null;
  nodeIds?: string[];
  rerunFailedOnly?: boolean;
  previousRunId?: string | null;
  triggerSource?: "web" | "ci" | "api";
  purpose?: string;
}

export interface ResolvedRunOptions {
  preset: RunPreset;
  headed: boolean;
  slowmo: number;
  vncPreview: boolean;
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
      vncPreview: preset.vncPreview,
      specFilter: body.specFilter ?? null,
      nodeIds: body.nodeIds ?? [],
      parentRunId: body.previousRunId ?? null,
    };
  }
  const headed = body.headed ?? true;
  return {
    preset: body.preset === "custom" ? "custom" : null,
    headed,
    slowmo: body.slowmo ?? 600,
    vncPreview: body.vncPreview ?? false,
    specFilter: body.specFilter ?? null,
    nodeIds: body.nodeIds ?? [],
    parentRunId: body.previousRunId ?? null,
  };
}

export function effectiveVncPreview(resolved: ResolvedRunOptions): boolean {
  return resolved.headed && resolved.vncPreview;
}

export function effectiveVncPreviewFromRunOptions(options: Record<string, unknown>): boolean {
  return options.headed === true && options.vncPreview === true;
}
