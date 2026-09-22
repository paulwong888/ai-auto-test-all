import { Router } from "express";
import type { AppConfig } from "../config.js";
import { isAppError } from "../errors.js";
import { assertApiTokenProject, requireProjectRole } from "../middleware/auth.js";
import type { AuthedRequest } from "../middleware/auth.js";
import type { RunService } from "../services/run-service.js";
import type { AuditService } from "../services/audit-service.js";
import { paramString, projectIdFromRequest } from "../utils/route-params.js";
import { proxyRunVncHttp } from "./run-vnc-proxy.js";

const projectId = projectIdFromRequest;

export function createRunRouter(
  runService: RunService,
  auditService: AuditService,
  config: AppConfig,
): Router {
  const router = Router({ mergeParams: true });

  router.post("/run", requireProjectRole("owner", "editor", "ci_bot"), async (req: AuthedRequest, res) => {
    try {
      const pid = projectId(req);
      const run = await runService.startRun(
        pid,
        {
          preset: req.body?.preset,
          headed: req.body?.headed,
          slowmo: req.body?.slowmo,
          vncPreview: req.body?.vncPreview,
          specFilter: req.body?.specFilter ?? null,
          nodeIds: Array.isArray(req.body?.nodeIds) ? req.body.nodeIds : undefined,
          rerunFailedOnly: req.body?.rerunFailedOnly === true,
          previousRunId: req.body?.previousRunId ?? null,
        },
        { userId: req.userId ?? null },
      );
      const vncFields = runService.getRunVncFields(pid, run, req.userId ?? null);
      await auditService.log({
        projectId: pid,
        userId: req.userId ?? null,
        action: "run.start",
        resource: run.id,
        metadata: { preset: run.preset, jobId: run.jobId },
      });
      res.status(202).json({
        ok: true,
        data: {
          runId: run.id,
          jobId: run.jobId,
          status: run.status,
          vncUrl: vncFields.vncUrl,
          vncToken: vncFields.vncToken,
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs", requireProjectRole("owner", "editor", "viewer", "ci_bot"), async (req, res) => {
    try {
      const runs = await runService.listRuns(projectId(req));
      res.json({ ok: true, data: { runs } });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId", requireProjectRole("owner", "editor", "viewer", "ci_bot"), async (req, res) => {
    try {
      const authed = req as AuthedRequest;
      const id = projectId(req);
      if (!assertApiTokenProject(authed, id, res)) return;
      const runId = paramString(req.params.runId);
      const run = await runService.getRun(id, runId);
      if (!run) {
        res.status(404).json({
          ok: false,
          error: { code: "RUN_NOT_FOUND", message: "Run not found" },
        });
        return;
      }
      const vncFields = runService.getRunVncFields(id, run, authed.userId ?? null);
      res.json({
        ok: true,
        data: {
          ...run,
          reportUrl: `/api/projects/${id}/runs/${runId}/report`,
          vncUrl: vncFields.vncUrl,
          vncToken: vncFields.vncToken,
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/vnc", async (req, res) => {
    try {
      const id = projectId(req);
      const runId = paramString(req.params.runId);
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const qs = new URLSearchParams();
      if (token) qs.set("token", token);
      qs.set("resize", "scale");
      qs.set("autoconnect", "true");
      qs.set("reconnect", "true");
      res.redirect(302, `/api/projects/${id}/runs/${runId}/vnc/vnc.html?${qs.toString()}`);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.use("/runs/:runId/vnc", async (req, res) => {
    try {
      const id = projectId(req);
      const runId = paramString(req.params.runId);
      const subPath = req.path && req.path !== "/" ? req.path : "/vnc.html";
      await proxyRunVncHttp(req, res, runService, config, id, runId, subPath);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/report", async (req, res) => {
    try {
      const reportPath = await runService.getReportPath(projectId(req), req.params.runId!);
      res.type("html").sendFile(reportPath);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/traces/:name", async (req, res) => {
    try {
      const tracePath = await runService.getTracePath(
        projectId(req),
        req.params.runId!,
        req.params.name!,
      );
      res.type("application/zip").sendFile(tracePath);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/runs/:runId/traces", async (req, res) => {
    try {
      const relPath = typeof req.query.path === "string" ? req.query.path : "";
      if (!relPath) {
        res.status(422).json({
          ok: false,
          error: { code: "PATH_REQUIRED", message: "path query parameter is required" },
        });
        return;
      }
      const tracePath = await runService.getTracePath(
        projectId(req),
        req.params.runId!,
        relPath,
      );
      res.type("application/zip").sendFile(tracePath);
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
