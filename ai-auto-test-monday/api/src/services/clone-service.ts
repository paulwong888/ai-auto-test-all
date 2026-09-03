import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  repoBackendPath,
  repoFrontendPath,
  resolveProjectPaths,
} from "@monday/agent-core";
import { config } from "../config.js";
import { getProject, updateCloneResult, setCloneStatus } from "./project-service.js";

const execFileAsync = promisify(execFile);

const GIT_ENV = () => ({
  ...process.env,
  GIT_SSH_COMMAND:
    process.env.GIT_SSH_COMMAND ??
    "ssh -o StrictHostKeyChecking=accept-new",
});

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function cloneOrPull(
  url: string,
  branch: string,
  dir: string,
): Promise<void> {
  const env = GIT_ENV();
  if (await pathExists(dir)) {
    await execFileAsync("git", ["-C", dir, "fetch", "origin"], {
      env,
      timeout: 300_000,
    });
    await execFileAsync("git", ["-C", dir, "checkout", branch], {
      env,
      timeout: 60_000,
    });
    await execFileAsync("git", ["-C", dir, "pull", "origin", branch], {
      env,
      timeout: 300_000,
    });
    return;
  }

  await mkdir(path.dirname(dir), { recursive: true });
  await execFileAsync(
    "git",
    ["clone", "--branch", branch, "--depth", "1", url, dir],
    { env, timeout: 300_000 },
  );
}

export class CloneInProgressError extends Error {
  constructor() {
    super("Clone already in progress");
    this.name = "CloneInProgressError";
  }
}

export async function runCloneProject(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const frontendUrl = project.frontendGitUrl?.trim() ?? "";
  const backendUrl = project.backendGitUrl?.trim() ?? "";
  const override = project.localPathOverride?.trim() ?? "";
  const paths = resolveProjectPaths(config.reposBaseDir, project);

  try {
    if (!frontendUrl && !backendUrl) {
      if (!override) {
        throw new Error(
          "No git URL or local path override configured for this project",
        );
      }
      if (!(await pathExists(override))) {
        throw new Error(`Local path does not exist: ${override}`);
      }
      await updateCloneResult(projectId, {
        status: "ready",
        error: null,
        frontendRepoPath: override,
        backendRepoPath: null,
      });
      return;
    }

    let frontendPath = paths.frontendPath;
    let backendPath = paths.backendPath;

    if (frontendUrl) {
      frontendPath = repoFrontendPath(config.reposBaseDir, projectId);
      await cloneOrPull(
        frontendUrl,
        project.frontendBranch,
        frontendPath,
      );
    } else if (override) {
      if (!(await pathExists(override))) {
        throw new Error(`Local path does not exist: ${override}`);
      }
      frontendPath = override;
    }

    if (backendUrl) {
      backendPath = repoBackendPath(config.reposBaseDir, projectId);
      await cloneOrPull(
        backendUrl,
        project.backendBranch,
        backendPath,
      );
    }

    await updateCloneResult(projectId, {
      status: "ready",
      error: null,
      frontendRepoPath: frontendPath,
      backendRepoPath: backendPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCloneResult(projectId, {
      status: "failed",
      error: message,
      frontendRepoPath: project.frontendRepoPath,
      backendRepoPath: project.backendRepoPath,
    });
  }
}

export async function startCloneProject(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  if (project.cloneStatus === "cloning") {
    throw new CloneInProgressError();
  }

  await setCloneStatus(projectId, "cloning", null);
  void runCloneProject(projectId);
}
