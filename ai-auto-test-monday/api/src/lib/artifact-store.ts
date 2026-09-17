import {
  getArtifactStore,
  resolveArtifactPrefix,
  type ArtifactStore,
} from "@monday/agent-core";
import { config } from "../config.js";

export function apiArtifactStore(): ArtifactStore {
  return getArtifactStore({
    store: config.artifactStore,
    fsBaseDir: config.artifactsBaseDir,
    minioEndpoint: config.minio.endpoint,
    minioBucket: config.minio.bucket,
    minioAccessKey: config.minio.accessKey,
    minioSecretKey: config.minio.secretKey,
    minioRegion: config.minio.region,
  });
}

export function runArtifactPrefix(
  run: Record<string, unknown>,
): string {
  return resolveArtifactPrefix(
    String(run.artifact_root),
    String(run.project_id),
    String(run.id),
  );
}
