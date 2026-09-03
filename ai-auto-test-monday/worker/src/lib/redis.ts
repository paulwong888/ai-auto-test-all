import { Redis } from "ioredis";

let client: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!client) {
    client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  }
  return client;
}

export async function publishProgress(
  runId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const redis = getRedis();
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
    // WS is best-effort in M0
  }
}
