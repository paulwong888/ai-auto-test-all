import path from "node:path";
import type { CloneStatus, Project, ResolvedProjectPaths } from "./types.js";

export function artifactRoot(
  baseDir: string,
  projectId: string,
  runId: string,
): string {
  return path.join(baseDir, projectId, runId);
}

export function repoFrontendPath(
  reposBase: string,
  projectId: string,
): string {
  return path.join(reposBase, projectId, "frontend");
}

export function repoBackendPath(reposBase: string, projectId: string): string {
  return path.join(reposBase, projectId, "backend");
}

export function resolveProjectPaths(
  reposBase: string,
  project: Project,
): ResolvedProjectPaths {
  const override = project.localPathOverride?.trim();
  if (override) {
    return {
      frontendPath: override,
      backendPath: project.backendGitUrl?.trim()
        ? repoBackendPath(reposBase, project.id)
        : null,
      source: "override",
    };
  }

  return {
    frontendPath: repoFrontendPath(reposBase, project.id),
    backendPath: project.backendGitUrl?.trim()
      ? repoBackendPath(reposBase, project.id)
      : null,
    source: "cloned",
  };
}

export function isProjectReadyForPipeline(
  project: Project,
  paths: ResolvedProjectPaths,
): boolean {
  if (paths.source === "override") {
    return project.cloneStatus === "ready";
  }
  return project.cloneStatus === "ready";
}

export function parseCloneStatus(value: unknown): CloneStatus {
  const s = String(value ?? "idle");
  if (
    s === "idle" ||
    s === "cloning" ||
    s === "ready" ||
    s === "failed"
  ) {
    return s;
  }
  return "idle";
}
