import { Redis } from "ioredis";
import type { WebSocket } from "ws";
import { config } from "../config.js";

const subscriptions = new Map<string, Set<WebSocket>>();
const subscribedChannels = new Set<string>();

let subscriber: Redis | null = null;
let publisher: Redis | null = null;
let messageHandlerAttached = false;

function getSubscriber(): Redis | null {
  if (!config.redisUrl) return null;
  if (!subscriber) {
    subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }
  return subscriber;
}

function getPublisher(): Redis | null {
  if (!config.redisUrl) return null;
  if (!publisher) {
    publisher = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }
  return publisher;
}

export async function publishRunEvent(
  runId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const redis = getPublisher();
  if (!redis) return;
  try {
    if (redis.status !== "ready") {
      await redis.connect();
    }
    await redis.publish(
      `pipeline:${runId}`,
      JSON.stringify({ runId, ...payload, ts: new Date().toISOString() }),
    );
  } catch {
    // WS is best-effort
  }
}

function attachMessageHandler(sub: Redis): void {
  if (messageHandlerAttached) return;
  messageHandlerAttached = true;
  sub.on("message", (channel, message) => {
    const runId = channel.startsWith("pipeline:")
      ? channel.slice("pipeline:".length)
      : channel;
    const sockets = subscriptions.get(runId);
    if (!sockets) return;
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
      }
    }
  });
}

export async function subscribeRun(ws: WebSocket, runId: string): Promise<void> {
  if (!subscriptions.has(runId)) {
    subscriptions.set(runId, new Set());
  }
  subscriptions.get(runId)!.add(ws);

  const sub = getSubscriber();
  if (!sub) return;

  attachMessageHandler(sub);

  const channel = `pipeline:${runId}`;
  if (!subscribedChannels.has(channel)) {
    subscribedChannels.add(channel);
    await sub.subscribe(channel);
  }
}

export function unsubscribeRun(ws: WebSocket, runId: string): void {
  const sockets = subscriptions.get(runId);
  if (!sockets) return;
  sockets.delete(ws);
  if (sockets.size === 0) {
    subscriptions.delete(runId);
    const channel = `pipeline:${runId}`;
    if (subscribedChannels.has(channel)) {
      subscribedChannels.delete(channel);
      void getSubscriber()?.unsubscribe(channel);
    }
  }
}

export async function checkRedis(): Promise<boolean> {
  const sub = getSubscriber();
  if (!sub) return true;
  try {
    await sub.ping();
    return true;
  } catch {
    return false;
  }
}
