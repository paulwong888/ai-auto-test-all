import { Router } from "express";
import { checkDbHealth } from "../db/pool.js";
import type { ProjectService } from "../services/project-service.js";
import type { RunService } from "../services/run-service.js";

export function createHealthRouter(
  projectService: ProjectService,
  runService: RunService,
): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const dbOk = await checkDbHealth().catch(() => false);
    const projectCount = dbOk ? await projectService.list().then((p) => p.length).catch(() => 0) : 0;
    const workerOk = await runService.checkWorkerHealth();
    const runStatus = runService.getStatus();

    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      data: {
        server: "up",
        database: dbOk ? "up" : "down",
        worker: workerOk ? "up" : "down",
        activeRun: runStatus.activeRun,
        projectCount,
      },
    });
  });

  return router;
}
