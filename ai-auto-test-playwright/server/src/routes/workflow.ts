import { Router } from "express";
import multer from "multer";
import { isAppError } from "../errors.js";
import { normalizeModuleName } from "../utils/module-name.js";
import type { CodegenService } from "../services/codegen-service.js";
import type { PlanService } from "../services/plan-service.js";
import type { WorkflowService } from "../services/workflow-service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
});

function projectId(req: import("express").Request): string {
  const id = (req.params as { id?: string }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("Missing project id");
  }
  return id;
}

export function createWorkflowRouter(deps: {
  workflowService: WorkflowService;
  planService: PlanService;
  codegenService: CodegenService;
}): Router {
  const router = Router({ mergeParams: true });

  router.post("/init-template", async (req, res) => {
    try {
      const result = await deps.workflowService.initTemplate(projectId(req));
      res.json({ ok: true, data: result });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/record/upload", upload.single("file"), async (req, res) => {
    try {
      const moduleName = normalizeModuleName(String(req.body?.moduleName ?? ""));
      if (!req.file) {
        res.status(422).json({
          ok: false,
          error: { code: "FILE_REQUIRED", message: "file field is required" },
        });
        return;
      }
      const data = await deps.workflowService.uploadRecording(projectId(req), moduleName, req.file);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/plan/generate", async (req, res) => {
    try {
      const id = projectId(req);
      const moduleName = await deps.planService.resolveModuleName(
        id,
        typeof req.body?.moduleName === "string" ? req.body.moduleName : undefined,
      );
      const job = await deps.planService.startPlanGeneration(id, moduleName);
      res.status(202).json({
        ok: true,
        data: {
          jobId: job.id,
          status: job.status,
          message: "Pi agent is generating test plan",
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/plan", async (req, res) => {
    try {
      const moduleName =
        typeof req.query.moduleName === "string" ? req.query.moduleName : undefined;
      const data = await deps.planService.getPlan(projectId(req), moduleName);
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/code/generate", async (req, res) => {
    try {
      const id = projectId(req);
      const moduleNameRaw = typeof req.body?.moduleName === "string" ? req.body.moduleName : "";
      const moduleName = moduleNameRaw
        ? normalizeModuleName(moduleNameRaw)
        : await deps.planService.resolveModuleName(id);
      const confirmPlan = req.body?.confirmPlan === true;
      const planVersionId =
        typeof req.body?.planVersionId === "string" ? req.body.planVersionId : undefined;
      const job = await deps.codegenService.startCodeGeneration(
        id,
        moduleName,
        confirmPlan,
        planVersionId,
      );
      res.status(202).json({
        ok: true,
        data: { jobId: job.id, status: job.status },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/files", async (req, res) => {
    try {
      const data = await deps.codegenService.listFiles(projectId(req));
      res.json({ ok: true, data });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/workflow", async (req, res) => {
    try {
      const data = await deps.workflowService.getWorkflow(projectId(req));
      res.json({ ok: true, data });
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
