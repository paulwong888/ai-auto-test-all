import { Router } from "express";
import type { ProjectService } from "../services/project-service.js";
import type { ProjectTemplateService } from "../services/project-template-service.js";

export function createProjectsRouter(
  projectService: ProjectService,
  templateService: ProjectTemplateService,
): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const projects = await projectService.list();
      res.json({
        ok: true,
        projects,
        allowedRepoPrefixes: projectService.getAllowedPrefixes(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const project = await projectService.create(req.body);
      res.status(201).json({ ok: true, project });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const project = await projectService.update(req.params.id!, req.body);
      res.json({ ok: true, project });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      await projectService.remove(req.params.id!);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.post("/:id/validate", async (req, res) => {
    try {
      const validation = await projectService.validate(req.params.id!);
      res.json({ ok: true, validation });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.post("/:id/init-template", async (req, res) => {
    try {
      const project = await projectService.resolve(req.params.id!);
      const result = await templateService.initTemplate(project.repoPath);
      const validation = await projectService.validate(req.params.id!);
      res.json({ ok: true, result, validation });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  router.post("/init-template", async (req, res) => {
    try {
      const repoPath = typeof req.body?.repoPath === "string" ? req.body.repoPath : "";
      if (!repoPath) {
        res.status(400).json({ ok: false, error: "repoPath is required" });
        return;
      }
      const result = await templateService.initTemplate(repoPath);
      res.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  return router;
}
