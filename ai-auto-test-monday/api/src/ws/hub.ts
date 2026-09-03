import { Redis } from "ioredis";
import type { WebSocket } from "ws";
import { config } from "../config.js";

let redis: Redis | null = null;
const subscriptions = new Map<string, Set<WebSocket>>();

export function getRedisSubscriber(): Redis | null {
  if (!config.redisUrl) return null;
  if (!redis) {
    redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }
  return redis;
}

export async function subscribeRun(ws: WebSocket, runId: string): Promise<void> {
  if (!subscriptions.has(runId)) {
    subscriptions.set(runId, new Set());
  }
  subscriptions.get(runId)!.add(ws);

  const sub = getRedisSubscriber();
  if (!sub) return;

  const channel = `pipeline:${runId}`;
  await sub.subscribe(channel);
  sub.on("message", (ch, message) => {
    if (ch !== channel) return;
    const sockets = subscriptions.get(runId);
    if (!sockets) return;
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  });
}

export function unsubscribeRun(ws: WebSocket, runId: string): void {
  subscriptions.get(runId)?.delete(ws);
}

export async function checkRedis(): Promise<boolean> {
  const sub = getRedisSubscriber();
  if (!sub) return true;
  try {
    await sub.ping();
    return true;
  } catch {
    return false;
  }
}
