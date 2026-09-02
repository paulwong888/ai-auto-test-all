import { Router } from "express";
import type { RunService } from "../services/run-service.js";

export function createRunRouter(runService: RunService): Router {
  const router = Router();

  /** POST /api/run — 驱动 Pi 执行指定 Gherkin 剧本 */
  router.post("/", async (req, res) => {
    const featureId = req.body?.featureId;
    if (typeof featureId !== "string" || !featureId) {
      res.status(400).json({ ok: false, error: "featureId is required" });
      return;
    }

    const projectId =
      typeof req.body?.projectId === "string" ? req.body.projectId : undefined;

    if (runService.isRunning()) {
      res.status(409).json({ ok: false, error: "已有劇本正在執行" });
      return;
    }

    try {
      const result = await runService.runScenario({
        featureId,
        projectId,
        repoPath: typeof req.body?.repoPath === "string" ? req.body.repoPath : undefined,
        targetUrl: typeof req.body?.targetUrl === "string" ? req.body.targetUrl : undefined,
      });
      res.json({ ok: true, runId: result.runId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: message });
    }
  });

  router.get("/status", (_req, res) => {
    res.json({ ok: true, ...runService.getStatus() });
  });

  router.post("/cancel", (_req, res) => {
    const cancelled = runService.cancelRun();
    if (!cancelled) {
      res.status(409).json({ ok: false, error: "目前沒有執行中的劇本" });
      return;
    }
    res.json({ ok: true, message: "已請求取消" });
  });

  return router;
}
