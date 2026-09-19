import { Router } from "express";
import { isAppError } from "../errors.js";
import type { PlanService } from "../services/plan-service.js";

function projectId(req: import("express").Request): string {
  const id = (req.params as { id?: string }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("Missing project id");
  }
  return id;
}

export function createPlanRouter(planService: PlanService): Router {
  const router = Router({ mergeParams: true });

  router.put("/plan", async (req, res) => {
    try {
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      if (!content.trim()) {
        res.status(422).json({
          ok: false,
          error: { code: "CONTENT_REQUIRED", message: "content is required" },
        });
        return;
      }
      const data = await planService.savePlan(projectId(req), {
        content,
        baseVersionId:
          typeof req.body?.baseVersionId === "string" ? req.body.baseVersionId : undefined,
        message: typeof req.body?.message === "string" ? req.body.message : undefined,
        moduleName: typeof req.body?.moduleName === "string" ? req.body.moduleName : undefined,
      });
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/plan/versions", async (req, res) => {
    try {
      const moduleName =
        typeof req.query.moduleName === "string" ? req.query.moduleName : undefined;
      const versions = await planService.listPlanVersions(projectId(req), moduleName);
      res.json({ ok: true, data: { versions } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/plan/versions/:versionId", async (req, res) => {
    try {
      const data = await planService.getPlanVersion(projectId(req), req.params.versionId!);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/plan/diff", async (req, res) => {
    try {
      const v1 = typeof req.query.v1 === "string" ? req.query.v1 : "";
      const v2 = typeof req.query.v2 === "string" ? req.query.v2 : "";
      if (!v1 || !v2) {
        res.status(422).json({
          ok: false,
          error: { code: "VERSIONS_REQUIRED", message: "v1 and v2 query parameters are required" },
        });
        return;
      }
      const diff = await planService.diffPlanVersions(projectId(req), v1, v2);
      res.json({ ok: true, data: { diff } });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function sendError(res: import("express").Response, err: unknown): void {
  if (isAppError(err)) {
    res.status(err.statusCode).json({
      ok: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message } });
}
