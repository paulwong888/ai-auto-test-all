import { Redis } from "ioredis";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) redis = new Redis(url, { maxRetriesPerRequest: null });
  return redis;
}

export class JobDeferredError extends Error {
  constructor(message = "Project busy, requeue") {
    super(message);
    this.name = "JobDeferredError";
  }
}

export async function withProjectLock<T>(
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = getRedis();
  if (!client) return fn();

  const key = `lock:project:${projectId}`;
  const ttl = Number(process.env.PROJECT_LOCK_TTL_SEC ?? 3600);
  const token = await client.set(key, "1", "EX", ttl, "NX");
  if (token !== "OK") {
    throw new JobDeferredError();
  }
  try {
    return await fn();
  } finally {
    await client.del(key);
  }
}

export async function isProjectLocked(projectId: string): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  const val = await client.get(`lock:project:${projectId}`);
  return val !== null;
}
