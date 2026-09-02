import type { RunHistoryEntry } from "./run-history-service.types.js";
export type { RunHistoryEntry } from "./run-history-service.types.js";

import { RunHistoryRepository } from "../repositories/run-history-repository.js";

const defaultRepo = new RunHistoryRepository();

export function truncateText(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + "…";
}

export function extractFailureSummary(chunks: string[]): string {
  const lines = chunks.join("\n").split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (/expect\(.+\).*failed/i.test(line)) return truncateText(line, 500);
    if (/Error:/i.test(line)) return truncateText(line, 500);
    if (/page\.goto:.*Test ended/i.test(line)) return truncateText(line, 500);
  }

  const fallback = lines.filter((l) => /fail|error|timeout/i.test(l)).at(-1) ?? "";
  return truncateText(fallback, 500);
}

export async function getLastFailedRun(
  projectId: string,
  featureId: string,
  repo: RunHistoryRepository = defaultRepo,
): Promise<RunHistoryEntry | null> {
  return repo.getLastFailedRun(projectId, featureId);
}

export async function saveRunHistoryEntry(
  projectId: string,
  featureId: string,
  entry: RunHistoryEntry,
  repo: RunHistoryRepository = defaultRepo,
): Promise<void> {
  await repo.upsert(projectId, featureId, entry);
}
