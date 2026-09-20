import { Router } from "express";
import { isAppError } from "../errors.js";
import type { CodegenService } from "../services/codegen-service.js";
import type { PlanService } from "../services/plan-service.js";
import type { ProjectService } from "../services/project-service.js";
import type { FixService } from "../services/fix-service.js";
import type { RunService } from "../services/run-service.js";
import type { WorkflowService } from "../services/workflow-service.js";
import type { GitService } from "../services/git-service.js";
import type { RecorderService } from "../services/recorder-service.js";
import type { AuditService } from "../services/audit-service.js";
import { AuthService } from "../services/auth-service.js";
import { createFixRouter } from "./fix.js";
import { createPlanRouter } from "./plan.js";
import { createRunRouter } from "./run.js";
import { createStatsRouter } from "./stats.js";
import { createWorkflowRouter } from "./workflow.js";
import { createGitRouter } from "./git.js";
import { createRecordLiveRouter } from "./record-live.js";
import { createTokensRouter } from "./tokens.js";
import { createMembersRouter } from "./members.js";
import { createAuditRouter } from "./audit.js";
import {
  authDisabled,
  rejectApiTokenUnlessScope,
  requireProjectMember,
  requireProjectRole,
  type AuthedRequest,
} from "../middleware/auth.js";
import { paramString } from "../utils/route-params.js";

const authService = new AuthService();

export function createProjectsRouter(
  projectService: ProjectService,
  deps?: {
    workflowService: WorkflowService;
    planService: PlanService;
    codegenService: CodegenService;
    runService: RunService;
    fixService: FixService;
    gitService: GitService;
    recorderService: RecorderService;
    auditService: AuditService;
  },
): Router {
  const router = Router();

  if (deps) {
    router.use("/:id", createPlanRouter(deps.planService));
    router.use("/:id", createWorkflowRouter(deps));
    router.use("/:id", createStatsRouter());
    router.use("/:id", createRunRouter(deps.runService, deps.auditService));
    router.use("/:id", createFixRouter(deps.fixService));
    router.use("/:id", createGitRouter(deps.gitService, projectService, deps.auditService));
    router.use("/:id", createRecordLiveRouter(deps.recorderService));
    router.use("/:id", createTokensRouter());
    router.use("/:id", createMembersRouter(deps.auditService));
    router.use("/:id", createAuditRouter(deps.auditService));
  }

  router.get("/", async (req: AuthedRequest, res) => {
    try {
      const projects =
        !authDisabled() && req.userId
          ? await projectService.listForUser(req.userId)
          : await projectService.list();
      res.json({ ok: true, data: { projects } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/", async (req: AuthedRequest, res) => {
    try {
      if (!authDisabled() && !req.userId) {
        res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Authentication required" } });
        return;
      }
      const project = await projectService.create(req.body);
      if (!authDisabled() && req.userId) {
        await authService.ensureProjectMember(project.id, req.userId, "owner");
      }
      res.status(201).json({ ok: true, data: project });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/:id", requireProjectMember(), async (req, res) => {
    try {
      const project = await projectService.getById(paramString(req.params.id));
      if (!project) {
        res.status(404).json({
          ok: false,
          error: { code: "PROJECT_NOT_FOUND", message: "Project not found" },
        });
        return;
      }
      res.json({ ok: true, data: project });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.put("/:id", requireProjectRole("owner", "editor"), async (req, res) => {
    try {
      const project = await projectService.update(String(req.params.id), req.body);
      res.json({ ok: true, data: project });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/:id", rejectApiTokenUnlessScope("admin"), requireProjectRole("owner"), async (req, res) => {
    try {
      await projectService.remove(String(req.params.id));
      res.json({ ok: true, data: { deleted: true } });
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
