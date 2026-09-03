import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { migrate, checkDb } from "./db/pool.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createPipelineRouter } from "./routes/pipeline.js";
import { seedDefaultProjects } from "./services/project-service.js";
import { checkTemporal } from "./services/pipeline-service.js";
import { checkRedis, subscribeRun, unsubscribeRun } from "./ws/hub.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", async (_req, res) => {
  const [db, temporal, redis] = await Promise.all([
    checkDb(),
    checkTemporal(),
    checkRedis(),
  ]);
  const ok = db && temporal;
  res.status(ok ? 200 : 503).json({
    ok,
    services: { db, temporal, redis },
  });
});

app.use("/api/projects", createProjectsRouter());
app.use("/api/pipeline", createPipelineRouter());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const runId = url.searchParams.get("runId");
  if (runId) {
    void subscribeRun(ws, runId);
    ws.on("close", () => unsubscribeRun(ws, runId));
  }
  ws.send(JSON.stringify({ type: "connected", runId }));
});

async function main(): Promise<void> {
  await migrate();
  await seedDefaultProjects();
  server.listen(config.port, config.host, () => {
    console.log(`[api] http://${config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error("[api] fatal", err);
  process.exit(1);
});
