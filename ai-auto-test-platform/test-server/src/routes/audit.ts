import { Router } from "express";
import type { AuditService } from "../services/audit-service.js";
import type { AuditJobService } from "../services/audit-job-service.js";

export function createAuditRouter(
  auditService: AuditService,
  auditJobService: AuditJobService,
): Router {
  const router = Router();

  /** POST /api/audit — 触发审计（core 同步 / full 走 jobs） */
  router.post("/", async (req, res) => {
    const projectId =
      typeof req.body?.projectId === "string" ? req.body.projectId : undefined;
    const repoPath = typeof req.body?.repoPath === "string" ? req.body.repoPath : undefined;
    const mode = req.body?.mode === "full" ? "full" : "core";

    if (mode === "full") {
      if (!projectId) {
        res.status(400).json({ ok: false, error: "projectId required for full audit" });
        return;
      }
      try {
        const job = await auditJobService.startFullAudit(projectId);
        res.json({ ok: true, jobId: job.id, job });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: message });
      }
      return;
    }

    try {
      const result = await auditService.runAudit({
        projectId,
        repoPath,
        mode: "core",
        onProgress: (event) => {
          if (event.kind === "text_delta") {
            process.stdout.write(event.delta);
          }
        },
      });

      res.json({
        ok: true,
        featuresPath: result.featuresPath,
        featureCount: result.features.features.length,
        features: result.features,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /** POST /api/audit/jobs — 启动完整分模块审计 */
  router.post("/jobs", async (req, res) => {
    const projectId =
      typeof req.body?.projectId === "string" ? req.body.projectId : undefined;

    if (!projectId) {
      res.status(400).json({ ok: false, error: "projectId required" });
      return;
    }

    try {
      const job = await auditJobService.startFullAudit(projectId);
      res.json({ ok: true, jobId: job.id, job });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /** GET /api/audit/jobs/:jobId — 查询审计 job 状态 */
  router.get("/jobs/:jobId", async (req, res) => {
    const job = await auditJobService.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: "Audit job not found" });
      return;
    }
    res.json({ ok: true, job });
  });

  /** POST /api/audit/jobs/:jobId/cancel — 取消审计 job */
  router.post("/jobs/:jobId/cancel", async (req, res) => {
    const job = await auditJobService.cancelJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ ok: false, error: "Audit job not found" });
      return;
    }
    res.json({ ok: true, job });
  });

  /** GET /api/audit/features — 读取已生成的 FEATURES.json */
  router.get("/features", async (req, res) => {
    const projectId =
      typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const repoPath = typeof req.query.repoPath === "string" ? req.query.repoPath : undefined;

    const features = await auditService.loadFeatures({ projectId, repoPath });
    if (!features) {
      res.status(404).json({ ok: false, error: "FEATURES.json not found. Run POST /api/audit first." });
      return;
    }

    res.json({ ok: true, features });
  });

  return router;
}
