import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { request as httpRequest } from "node:http";
import { parse as parseUrl } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { authDisabled } from "../middleware/auth.js";
import type { RecorderService } from "../services/recorder-service.js";
import { verifyVncToken } from "./record-live.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const PROXY_TIMEOUT_MS = 30_000;

function stripHopByHopHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

export function recorderVncHost(): string {
  return process.env.RECORDER_VNC_HOST ?? "host.docker.internal";
}

export function parseVncProxyPath(pathname: string): { projectId: string; sessionId: string; subPath: string } | null {
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/record\/([^/]+)\/vnc(\/.*)?$/);
  if (!match) return null;
  return {
    projectId: match[1]!,
    sessionId: match[2]!,
    subPath: match[3] || "/vnc.html",
  };
}

async function resolveSession(
  recorder: RecorderService,
  projectId: string,
  sessionId: string,
  token: string,
): Promise<{ vncPort: number } | null> {
  if (!authDisabled()) {
    const userId = verifyVncToken(token, sessionId);
    if (!userId) return null;
  }
  const session = await recorder.getSession(projectId, sessionId);
  if (!session?.vnc_port) return null;
  await recorder.touchSession(sessionId);
  return { vncPort: session.vnc_port };
}

export async function proxyVncHttp(
  req: IncomingMessage,
  res: ServerResponse,
  recorder: RecorderService,
  projectId: string,
  sessionId: string,
  subPath: string,
): Promise<void> {
  const url = parseUrl(req.url ?? "", false);
  const token = new URL(req.url ?? "", "http://localhost").searchParams.get("token") ?? "";

  const resolved = await resolveSession(recorder, projectId, sessionId, token);
  if (!resolved) {
    res.statusCode = authDisabled() ? 404 : 401;
    res.end(authDisabled() ? "Session not found" : "Unauthorized");
    return;
  }

  const upstreamPath = `${subPath}${url.search ?? ""}`;
  const host = recorderVncHost();
  const clientMethod = req.method ?? "GET";
  const upstreamMethod = clientMethod === "HEAD" ? "GET" : clientMethod;
  const proxyReq = httpRequest(
    {
      hostname: host,
      port: resolved.vncPort,
      path: upstreamPath,
      method: upstreamMethod,
      headers: {
        ...stripHopByHopHeaders(req.headers),
        host: `${host}:${resolved.vncPort}`,
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
    proxyReq.destroy(new Error("VNC proxy timeout"));
  });
  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end(`VNC proxy error: ${err.message}`);
    }
  });
  if (clientMethod === "GET" || clientMethod === "HEAD") {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

export async function handleVncWebSocketUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  recorder: RecorderService,
): Promise<void> {
  const pathname = parseUrl(req.url ?? "", false).pathname ?? "";
  const parsed = parseVncProxyPath(pathname);
  if (!parsed) {
    socket.destroy();
    return;
  }

  const url = parseUrl(req.url ?? "", false);
  const token = new URL(req.url ?? "", "http://localhost").searchParams.get("token") ?? "";
  const resolved = await resolveSession(recorder, parsed.projectId, parsed.sessionId, token);
  if (!resolved) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const host = recorderVncHost();
  const targetUrl = `ws://${host}:${resolved.vncPort}${parsed.subPath}${url.search ?? ""}`;

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
