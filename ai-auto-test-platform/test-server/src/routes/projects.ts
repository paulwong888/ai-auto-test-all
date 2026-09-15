import { Router } from "express";
import { initTemplateInputSchema } from "../schemas/project.js";
import { parseFeaturesDocument } from "../schemas/features.js";
import type { ProjectService } from "../services/project-service.js";
import type { ProjectTemplateService } from "../services/project-template-service.js";
import type { ResolvedProject } from "../services/project-service.js";
import type { FeatureService } from "../services/feature-service.js";
import { FeaturesRepository } from "../repositories/features-repository.js";

function parseInitTemplateOptions(
  body: unknown,
  project?: ResolvedProject,
) {
  const data = initTemplateInputSchema.parse(body ?? {});
  return {
    targetUrl: project?.targetUrl ?? "",
    authMode: data.authMode ?? project?.authMode ?? "none",
    e2eUsername: data.e2eUsername,
    e2ePassword: data.e2ePassword,
  };
}

export function createProjectsRouter(
  projectService: ProjectService,
  templateService: ProjectTemplateService,
  featureService?: FeatureService,
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

  if (featureService) {
    router.get("/:id/features/:featureId", async (req, res) => {
      try {
        const feature = await featureService.getFeature(req.params.id!, req.params.featureId!);
        if (!feature) {
          res.status(404).json({ ok: false, error: "Feature not found" });
          return;
        }
        res.json({ ok: true, feature });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: message });
      }
    });

    router.patch("/:id/features/:featureId", async (req, res) => {
      try {
        const feature = await featureService.updateFeature(
          req.params.id!,
          req.params.featureId!,
          req.body,
        );
        res.json({ ok: true, feature });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ ok: false, error: message });
      }
    });

    router.post("/:id/features/import", async (req, res) => {
      try {
        const project = await projectService.resolve(req.params.id!);
        const doc = parseFeaturesDocument(req.body);
        const featuresRepo = new FeaturesRepository();
        const persisted = await featuresRepo.upsertFeaturesFromAudit(
          project.id,
          doc.repoPath || project.repoPath,
          doc.features,
          "import",
        );
        res.json({ ok: true, features: persisted });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ ok: false, error: message });
      }
    });
  }

  router.post("/:id/init-template", async (req, res) => {
    try {
      const project = await projectService.resolve(req.params.id!);
      const options = parseInitTemplateOptions(req.body, project);
      const result = await templateService.initTemplate(project.repoPath, options);
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
      const targetUrl = typeof req.body?.targetUrl === "string" ? req.body.targetUrl : "";
      if (!repoPath) {
        res.status(400).json({ ok: false, error: "repoPath is required" });
        return;
      }
      if (!targetUrl) {
        res.status(400).json({ ok: false, error: "targetUrl is required" });
        return;
      }
      const data = initTemplateInputSchema.parse(req.body ?? {});
      const result = await templateService.initTemplate(repoPath, {
        targetUrl,
        authMode: data.authMode ?? "none",
        e2eUsername: data.e2eUsername,
        e2ePassword: data.e2ePassword,
      });
      res.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ ok: false, error: message });
    }
  });

  return router;
}
