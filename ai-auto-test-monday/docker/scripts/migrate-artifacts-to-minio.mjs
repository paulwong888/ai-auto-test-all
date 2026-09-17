#!/usr/bin/env node
/**
 * Migrate ./data/artifacts/{projectId}/{runId}/** to MinIO and update DB artifact_root.
 *
 * Usage (from docker/):
 *   node scripts/migrate-artifacts-to-minio.mjs [--dry-run]
 *
 * Env: MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ACCESS_KEY, MINIO_SECRET_KEY,
 *      POSTGRES_* (same as api)
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  PutObjectCommand,
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactsDir = path.join(__dirname, "../data/artifacts");
const dryRun = process.argv.includes("--dry-run");

const minioEndpoint = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const bucket = process.env.MINIO_BUCKET ?? "monday-artifacts";
const accessKey = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const secretKey = process.env.MINIO_SECRET_KEY ?? "minioadmin";

const s3 = new S3Client({
  endpoint: minioEndpoint,
  region: process.env.MINIO_REGION ?? "us-east-1",
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  forcePathStyle: true,
});

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5433),
  database: process.env.POSTGRES_DB ?? "ai_auto_test_monday",
  user: process.env.POSTGRES_USER ?? "postgres",
  password: process.env.POSTGRES_PASSWORD ?? "postgres",
});

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    if (!dryRun) {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    console.log(`[migrate] bucket ${bucket} created`);
  }
}

async function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await walkFiles(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  await ensureBucket();

  let projects;
  try {
    projects = await readdir(artifactsDir);
  } catch {
    console.log("[migrate] no artifacts directory, nothing to do");
    await pool.end();
    return;
  }

  let uploaded = 0;
  let updatedRuns = 0;

  for (const projectId of projects) {
    const projectDir = path.join(artifactsDir, projectId);
    const projectStat = await stat(projectDir);
    if (!projectStat.isDirectory()) continue;

    const runIds = await readdir(projectDir);
    for (const runId of runIds) {
      const runDir = path.join(projectDir, runId);
      const runStat = await stat(runDir);
      if (!runStat.isDirectory()) continue;

      const prefix = `${projectId}/${runId}`;
      const files = await walkFiles(runDir);
      for (const filePath of files) {
        const rel = path.relative(runDir, filePath).replace(/\\/g, "/");
        const key = `${prefix}/${rel}`;
        if (dryRun) {
          console.log(`[dry-run] would upload ${filePath} -> ${key}`);
        } else {
          const body = await readFile(filePath);
          await s3.send(
            new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
          );
        }
        uploaded += 1;
      }

      if (!dryRun) {
        const { rowCount } = await pool.query(
          `UPDATE pipeline_runs SET artifact_root = $1 WHERE id = $2`,
          [prefix, runId],
        );
        if (rowCount && rowCount > 0) updatedRuns += rowCount;
      } else {
        console.log(`[dry-run] would set artifact_root=${prefix} for run ${runId}`);
      }
    }
  }

  console.log(
    `[migrate] done uploaded=${uploaded} dbRunsUpdated=${updatedRuns} dryRun=${dryRun}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
