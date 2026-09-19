import { Router } from "express";
import { isAppError } from "../errors.js";
import type { GitService } from "../services/git-service.js";
import type { ProjectService } from "../services/project-service.js";
import { requireProjectRole } from "../middleware/auth.js";

function projectId(req: import("express").Request): string {
  return (req.params as { id: string }).id;
}

export function createGitRouter(gitService: GitService, projectService: ProjectService): Router {
  const router = Router({ mergeParams: true });

  router.put("/git", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      await gitService.bindRepo(
        projectId(req),
        String(req.body?.repoUrl ?? ""),
        String(req.body?.token ?? ""),
        String(req.body?.defaultBranch ?? "main"),
      );
      res.json({ ok: true, data: { bound: true } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/git", async (req, res) => {
    try {
      const binding = await gitService.getBinding(projectId(req));
      res.json({
        ok: true,
        data: binding ? { repoUrl: binding.repoUrl, defaultBranch: binding.defaultBranch } : null,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/git/sync", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const project = await projectService.getById(projectId(req));
      if (!project) throw new Error("Project not found");
      await gitService.sync(project.workspacePath, projectId(req));
      res.json({ ok: true, data: { synced: true } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/git/push", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const project = await projectService.getById(projectId(req));
      if (!project) throw new Error("Project not found");
      const message = String(req.body?.message ?? "chore(e2e): update tests");
      const { branch } = await gitService.push(project.workspacePath, projectId(req), message);
      res.json({ ok: true, data: { branch } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/git/pr", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const branch = String(req.body?.branch ?? "");
      const title = String(req.body?.title ?? "E2E test updates");
      const { url } = await gitService.createPullRequest(projectId(req), branch, title);
      res.json({ ok: true, data: { url } });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function sendError(res: import("express").Response, err: unknown): void {
  if (isAppError(err)) {
    res.status(err.statusCode).json({ ok: false, error: { code: err.code, message: err.message } });
    return;
  }
  res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: String(err) } });
}
