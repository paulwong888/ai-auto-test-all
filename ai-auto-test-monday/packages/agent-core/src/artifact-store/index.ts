import type { ArtifactStore, ArtifactStoreConfig } from "./types.js";
import { createFsArtifactStore } from "./fs-store.js";
import { createMinioArtifactStore } from "./minio-store.js";

export type { ArtifactStore, ArtifactStoreConfig } from "./types.js";
export { createFsArtifactStore } from "./fs-store.js";
export {
  artifactPrefix,
  artifactObjectKey,
  toRelativeArtifactKey,
} from "./keys.js";
export {
  pullToLocal,
  pushFromLocal,
  removeLocalStaging,
} from "./staging.js";

let cached: ArtifactStore | null = null;
let cachedKey = "";

export function loadArtifactStoreConfigFromEnv(): ArtifactStoreConfig {
  return {
    store: process.env.ARTIFACT_STORE === "minio" ? "minio" : "fs",
    fsBaseDir: process.env.ARTIFACTS_BASE_DIR ?? "/data/artifacts",
    minioEndpoint: process.env.MINIO_ENDPOINT,
    minioBucket: process.env.MINIO_BUCKET ?? "monday-artifacts",
    minioAccessKey: process.env.MINIO_ACCESS_KEY,
    minioSecretKey: process.env.MINIO_SECRET_KEY,
    minioRegion: process.env.MINIO_REGION ?? "us-east-1",
  };
}

export function createArtifactStore(config: ArtifactStoreConfig): ArtifactStore {
  if (config.store === "minio") {
    if (
      !config.minioEndpoint ||
      !config.minioAccessKey ||
      !config.minioSecretKey
    ) {
      throw new Error(
        "MinIO artifact store requires MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY",
      );
    }
    return createMinioArtifactStore({
      endpoint: config.minioEndpoint,
      bucket: config.minioBucket ?? "monday-artifacts",
      accessKey: config.minioAccessKey,
      secretKey: config.minioSecretKey,
      region: config.minioRegion,
    });
  }
  return createFsArtifactStore(config.fsBaseDir ?? "/data/artifacts");
}

export function getArtifactStore(config?: ArtifactStoreConfig): ArtifactStore {
  const cfg = config ?? loadArtifactStoreConfigFromEnv();
  const key = JSON.stringify(cfg);
  if (cached && cachedKey === key) return cached;
  cached = createArtifactStore(cfg);
  cachedKey = key;
  return cached;
}

/** Resolve run artifact prefix from DB artifact_root (legacy path or new prefix). */
export function resolveArtifactPrefix(
  artifactRoot: string,
  projectId?: string,
  runId?: string,
): string {
  const normalized = artifactRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized.includes("/artifacts/") && !pathLooksAbsolute(normalized)) {
    return normalized;
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  if (projectId && runId) return `${projectId}/${runId}`;
  return normalized;
}

function pathLooksAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:/.test(p);
}
