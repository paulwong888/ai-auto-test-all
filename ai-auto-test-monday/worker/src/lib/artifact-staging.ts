import os from "node:os";
import path from "node:path";
import type { PipelineInput } from "@monday/agent-core/workflow";
import {
  artifactPrefix,
  getArtifactStore,
  pullToLocal,
  pushFromLocal,
  removeLocalStaging,
  resolveArtifactPrefix,
} from "@monday/agent-core";

export function runArtifactPrefix(input: PipelineInput): string {
  return resolveArtifactPrefix(
    input.artifactRoot,
    input.projectId,
    input.runId,
  );
}

export interface StagingContext {
  flush: () => Promise<void>;
}

export async function withArtifactStaging<T>(
  input: PipelineInput,
  run: (localInput: PipelineInput, staging: StagingContext) => Promise<T>,
): Promise<T> {
  const store = getArtifactStore();
  const prefix = runArtifactPrefix(input);
  const localRoot = path.join(os.tmpdir(), "monday-artifacts", input.runId);
  await pullToLocal(store, prefix, localRoot);
  const flush = () => pushFromLocal(store, prefix, localRoot);
  try {
    return await run({ ...input, artifactRoot: localRoot }, { flush });
  } finally {
    await flush();
    await removeLocalStaging(localRoot);
  }
}

export { artifactPrefix };
