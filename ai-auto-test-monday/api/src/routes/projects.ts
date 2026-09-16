import { Router } from "express";
import { createProjectSchema, updateProjectSchema } from "@monday/agent-core";
import {
  CloneInProgressError,
  startCloneProject,
} from "../services/clone-service.js";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  toPublicProject,
  updateProject,
} from "../services/project-service.js";

export function createProjectsRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const projects = await listProjects();
    res.json({ ok: true, projects: projects.map(toPublicProject) });
  });

  router.post("/", async (req, res) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    const project = await createProject(parsed.data);
    res.status(201).json({ ok: true, project: toPublicProject(project) });
  });

  router.get("/:id", async (req, res) => {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    res.json({ ok: true, project: toPublicProject(project) });
  });

  router.put("/:id", async (req, res) => {
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    const project = await updateProject(req.params.id, parsed.data);
    if (!project) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    res.json({ ok: true, project: toPublicProject(project) });
  });

  router.delete("/:id", async (req, res) => {
    const deleted = await deleteProject(req.params.id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/:id/clone", async (req, res) => {
    const project = await getProject(req.params.id);
    if (!project) {
      res.status(404).json({ ok: false, error: "not found" });
      return;
    }
    try {
      await startCloneProject(req.params.id);
      res.status(202).json({
        ok: true,
        message: "clone started",
        cloneStatus: "cloning",
      });
    } catch (err) {
      if (err instanceof CloneInProgressError) {
        res.status(409).json({ ok: false, error: err.message });
        return;
      }
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
