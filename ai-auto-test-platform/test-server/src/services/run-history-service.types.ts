export interface RunHistoryEntry {
  lastSuccess: boolean;
  lastRunAt: string;
  playwrightAttempts: number;
  failureSummary?: string;
  lastPlaywrightExitError?: string;
}

/** @deprecated legacy file format for import only */
export interface RunHistoryDocument {
  version: "1";
  byFeature: Record<string, RunHistoryEntry>;
}
