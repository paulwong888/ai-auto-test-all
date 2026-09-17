export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3010),
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  artifactsBaseDir: process.env.ARTIFACTS_BASE_DIR ?? "/data/artifacts",
  artifactStore:
    process.env.ARTIFACT_STORE === "minio" ? ("minio" as const) : ("fs" as const),
  minio: {
    endpoint: process.env.MINIO_ENDPOINT ?? "",
    bucket: process.env.MINIO_BUCKET ?? "monday-artifacts",
    accessKey: process.env.MINIO_ACCESS_KEY ?? "",
    secretKey: process.env.MINIO_SECRET_KEY ?? "",
    region: process.env.MINIO_REGION ?? "us-east-1",
  },
  reposBaseDir: process.env.REPOS_BASE_DIR ?? "/data/repos",
  redisUrl: process.env.REDIS_URL ?? "",
  postgres: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? 5433),
    database: process.env.POSTGRES_DB ?? "ai_auto_test_monday",
    user: process.env.POSTGRES_USER ?? "postgres",
    password: process.env.POSTGRES_PASSWORD ?? "postgres",
  },
} as const;
