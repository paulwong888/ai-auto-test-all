import { createServer } from "node:http";
import type { Socket } from "node:net";
import { parse as parseUrl } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { initDatabase } from "./db/init-db.js";
import { requireAuth } from "./middleware/auth.js";
import { createAuthRouter } from "./routes/auth.js";
import { createGitRouter } from "./routes/git.js";
import { createHealthRouter } from "./routes/health.js";
import { createJobsRouter } from "./routes/jobs.js";
import { createProjectsRouter } from "./routes/projects.js";
import { handleRunVncWebSocketUpgrade, parseRunVncProxyPath } from "./routes/run-vnc-proxy.js";
import { handleVncWebSocketUpgrade, parseVncProxyPath } from "./routes/vnc-proxy.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { CodegenService } from "./services/codegen-service.js";
import { PlanService } from "./services/plan-service.js";
import { PiJobRunner } from "./services/pi-job-runner.js";
import { ProjectService } from "./services/project-service.js";
import { ProjectTemplateService } from "./services/project-template-service.js";
import { FixService } from "./services/fix-service.js";
import { RunService } from "./services/run-service.js";
import { WorkflowService } from "./services/workflow-service.js";
import { GitService } from "./services/git-service.js";
import { RecorderService } from "./services/recorder-service.js";
import { JobScheduler } from "./services/job-scheduler.js";
import { AuditService } from "./services/audit-service.js";
import { wsHub } from "./ws/ws-hub.js";

const app = express();
const projectService = new ProjectService(config);
const templateService = new ProjectTemplateService(config);
const workflowService = new WorkflowService(projectService, templateService);
const piJobRunner = new PiJobRunner(config);
const planService = new PlanService(config, projectService, piJobRunner);
const codegenService = new CodegenService(config, projectService, piJobRunner);
const runService = new RunService(config, projectService);
const fixService = new FixService(config, projectService, piJobRunner);
fixService.setRunService(runService);
const gitService = new GitService(templateService);
const recorderService = new RecorderService(projectService);
const auditService = new AuditService();
const jobScheduler = new JobScheduler();
jobScheduler.start();

app.use(cors());
app.use(express.json());

app.use("/health", createHealthRouter(projectService, runService));
app.use("/api/auth", createAuthRouter());
app.use("/api/webhooks", createWebhooksRouter(runService));

app.use("/api/projects", requireAuth, createProjectsRouter(projectService, {
  workflowService,
  planService,
  codegenService,
  runService,
  fixService,
  gitService,
  recorderService,
  auditService,
}));
app.use("/api/jobs", requireAuth, createJobsRouter({ piJobRunner, runService }));

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => {
  wsHub.add(socket);
  socket.send(JSON.stringify({ type: "connected", message: "Playwright workflow stream ready" }));
});

server.on("upgrade", (req, socket, head) => {
  const pathname = parseUrl(req.url ?? "", false).pathname ?? "";
  if (pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (parseVncProxyPath(pathname)) {
    void handleVncWebSocketUpgrade(req, socket as Socket, head, recorderService);
    return;
  }
  if (parseRunVncProxyPath(pathname)) {
    void handleRunVncWebSocketUpgrade(req, socket as Socket, head, runService, config);
    return;
  }
  socket.destroy();
});

async function main(): Promise<void> {
  await initDatabase(config);
  server.listen(config.port, config.host, () => {
    console.log(`[server] listening on http://${config.host}:${config.port}`);
    console.log(`[server] WebSocket ws://${config.host}:${config.port}/ws`);
    console.log(`[server] redis ${process.env.REDIS_URL ?? "disabled"}`);
    console.log(`[server] auth ${process.env.AUTH_DISABLED === "true" ? "disabled" : "enabled"}`);
  });
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
