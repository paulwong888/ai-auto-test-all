import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { request as httpRequest } from "node:http";
import { parse as parseUrl } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import type { AppConfig } from "../config.js";
import { authDisabled } from "../middleware/auth.js";
import type { RunService } from "../services/run-service.js";
import { verifyVncToken } from "./vnc-tokens.js";
import { stripHopByHopHeaders } from "./vnc-proxy.js";

const PROXY_TIMEOUT_MS = 30_000;

export function parseRunVncProxyPath(
  pathname: string,
): { projectId: string; runId: string; subPath: string } | null {
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/runs\/([^/]+)\/vnc(\/.*)?$/);
  if (!match) return null;
  return {
    projectId: match[1]!,
    runId: match[2]!,
    subPath: match[3] || "/vnc.html",
  };
}

async function assertRunVncAllowed(
  runService: RunService,
  projectId: string,
  runId: string,
  token: string,
): Promise<boolean> {
  if (!authDisabled()) {
    if (!verifyVncToken(token, runId, "run")) return false;
  }
  const meta = await runService.getRunVncMeta(projectId, runId);
  return meta !== null;
}

export async function proxyRunVncHttp(
  req: IncomingMessage,
  res: ServerResponse,
  runService: RunService,
  config: AppConfig,
  projectId: string,
  runId: string,
  subPath: string,
): Promise<void> {
  const url = parseUrl(req.url ?? "", false);
  const token = new URL(req.url ?? "", "http://localhost").searchParams.get("token") ?? "";

  const allowed = await assertRunVncAllowed(runService, projectId, runId, token);
  if (!allowed) {
    res.statusCode = authDisabled() ? 404 : 401;
    res.end(authDisabled() ? "Run VNC not available" : "Unauthorized");
    return;
  }

  const upstreamPath = `${subPath}${url.search ?? ""}`;
  const clientMethod = req.method ?? "GET";
  const upstreamMethod = clientMethod === "HEAD" ? "GET" : clientMethod;
  const proxyReq = httpRequest(
    {
      hostname: config.workerVncHost,
      port: config.workerVncPort,
      path: upstreamPath,
      method: upstreamMethod,
      headers: {
        ...stripHopByHopHeaders(req.headers),
        host: `${config.workerVncHost}:${config.workerVncPort}`,
      },
    },
    (proxyRes) => {
      const headers = stripHopByHopHeaders(proxyRes.headers);
      if (clientMethod === "HEAD") {
        delete headers["content-length"];
        delete headers["Content-Length"];
        delete headers["transfer-encoding"];
        delete headers["Transfer-Encoding"];
        headers["Content-Length"] = "0";
      }
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      if (clientMethod === "HEAD") {
        proxyRes.resume();
        res.end();
      } else {
        proxyRes.pipe(res);
      }
    },
  );
  proxyReq.setTimeout(PROXY_TIMEOUT_MS, () => {
    proxyReq.destroy(new Error("Run VNC proxy timeout"));
  });
  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end(`Run VNC proxy error: ${err.message}`);
    }
  });
  if (clientMethod === "GET" || clientMethod === "HEAD") {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

export async function handleRunVncWebSocketUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  runService: RunService,
  config: AppConfig,
): Promise<void> {
  const pathname = parseUrl(req.url ?? "", false).pathname ?? "";
  const parsed = parseRunVncProxyPath(pathname);
  if (!parsed) {
    socket.destroy();
    return;
  }

  const url = parseUrl(req.url ?? "", false);
  const token = new URL(req.url ?? "", "http://localhost").searchParams.get("token") ?? "";
  const allowed = await assertRunVncAllowed(runService, parsed.projectId, parsed.runId, token);
  if (!allowed) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const targetUrl = `ws://${config.workerVncHost}:${config.workerVncPort}${parsed.subPath}${url.search ?? ""}`;

  const upgrade = new WebSocketServer({ noServer: true });
  upgrade.handleUpgrade(req, socket, head, (clientWs: WebSocket) => {
    const targetWs = new WebSocket(targetUrl);
    const closeBoth = () => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      if (targetWs.readyState === WebSocket.OPEN) targetWs.close();
    };
    targetWs.on("open", () => {
      clientWs.on("message", (data: WebSocket.RawData, isBinary: boolean) =>
        targetWs.send(data, { binary: isBinary }),
      );
      targetWs.on("message", (data: WebSocket.RawData, isBinary: boolean) =>
        clientWs.send(data, { binary: isBinary }),
      );
      clientWs.on("close", closeBoth);
      targetWs.on("close", closeBoth);
      clientWs.on("error", closeBoth);
      targetWs.on("error", closeBoth);
    });
    targetWs.on("error", () => {
      clientWs.close();
    });
  });
}
