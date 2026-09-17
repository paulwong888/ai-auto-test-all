/** Logical object prefix: `{projectId}/{runId}` (no leading slash). */
export function artifactPrefix(projectId: string, runId: string): string {
  return `${projectId}/${runId}`;
}

/** Join prefix + relative key (e.g. `journeys.json`, `poms/Foo.ts`). */
export function artifactObjectKey(prefix: string, relativeKey: string): string {
  const rel = relativeKey.replace(/^\/+/, "");
  return `${prefix.replace(/\/+$/, "")}/${rel}`;
}

/** Normalize DB / index paths to relative object keys. */
export function toRelativeArtifactKey(
  filePath: string,
  prefix?: string,
): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (prefix) {
    const p = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized.startsWith(`${p}/`)) {
      return normalized.slice(p.length + 1);
    }
    if (normalized === p) return "";
  }
  const artifactsIdx = normalized.indexOf("/artifacts/");
  if (artifactsIdx >= 0) {
    const after = normalized.slice(artifactsIdx + "/artifacts/".length);
    const slash = after.indexOf("/");
    if (slash >= 0) return after.slice(slash + 1);
  }
  return pathBasenameOrRelative(normalized);
}

function pathBasenameOrRelative(normalized: string): string {
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[parts.length - 2] === "poms") {
    return `poms/${parts[parts.length - 1]}`;
  }
  if (parts.length >= 2 && parts[parts.length - 2] === "tests") {
    return `tests/${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1] ?? normalized;
}
