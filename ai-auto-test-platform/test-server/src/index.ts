import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { initDatabase } from "./db/init-db.js";
import { checkDbHealth } from "./db/pool.js";
import { createAuditRouter } from "./routes/audit.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createRunRouter } from "./routes/run.js";
import { AuditService } from "./services/audit-service.js";
import { AuditJobService } from "./services/audit-job-service.js";
import { ProjectService } from "./services/project-service.js";
import { ProjectTemplateService } from "./services/project-template-service.js";
import { FeatureService } from "./services/feature-service.js";
import { RunService } from "./services/run-service.js";
import { wsHub } from "./ws/ws-hub.js";

const app = express();
const projectService = new ProjectService(config);
const templateService = new ProjectTemplateService(config);
const auditService = new AuditService(config, projectService);
const featureService = new FeatureService(auditService.getFeaturesRepository());
const auditJobService = new AuditJobService(config, projectService, auditService);
const runService = new RunService(config, projectService, auditService.getFeaturesRepository());

app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  const dbOk = await checkDbHealth().catch(() => false);
  const projects = dbOk ? await projectService.list().catch(() => []) : [];
  res.json({
    ok: dbOk,
    service: "test-server",
    db: dbOk ? "ok" : "error",
    projectCount: projects.length,
    postgres: {
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
    },
  });
});

app.use("/api/projects", createProjectsRouter(projectService, templateService, featureService));
app.use("/api/audit", createAuditRouter(auditService, auditJobService));
app.use("/api/run", createRunRouter(runService));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  wsHub.add(socket);
  socket.send(JSON.stringify({ type: "connected", message: "BDD live stream ready" }));
});

async function main(): Promise<void> {
  await initDatabase(config);
  await projectService.init();
  await auditJobService.init();
  server.listen(config.port, config.host, () => {
    console.log(`[test-server] listening on http://${config.host}:${config.port}`);
    console.log(`[test-server] WebSocket ws://${config.host}:${config.port}/ws`);
    console.log(
      `[test-server] postgres ${config.postgres.host}:${config.postgres.port}/${config.postgres.database}`,
    );
  });
}

main().catch((err) => {
  console.error("[test-server] failed to start:", err);
  process.exit(1);
});
