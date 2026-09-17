import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ArtifactStore } from "./types.js";
import { artifactObjectKey } from "./keys.js";

async function streamToString(body: unknown): Promise<string> {
  if (!body || typeof body !== "object") return "";
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createMinioArtifactStore(options: {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}): ArtifactStore {
  const client = new S3Client({
    region: options.region ?? "us-east-1",
    endpoint: options.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
    },
  });
  const bucket = options.bucket;

  async function ensureBucket(): Promise<void> {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }

  return {
    async getText(prefix, relativeKey) {
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: artifactObjectKey(prefix, relativeKey),
          }),
        );
        return await streamToString(res.Body);
      } catch {
        return null;
      }
    },
    async putText(prefix, relativeKey, content) {
      await ensureBucket();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: artifactObjectKey(prefix, relativeKey),
          Body: content,
          ContentType: relativeKey.endsWith(".json")
            ? "application/json"
            : "text/plain",
        }),
      );
    },
    async deleteObject(prefix, relativeKey) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: artifactObjectKey(prefix, relativeKey),
          }),
        );
      } catch {
        // ignore
      }
    },
    async listRelativeKeys(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      const p = prefix.replace(/\/+$/, "");
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: `${p}/`,
            ContinuationToken: token,
          }),
        );
        for (const obj of res.Contents ?? []) {
          if (!obj.Key || obj.Key.endsWith("/")) continue;
          keys.push(obj.Key.slice(p.length + 1));
        }
        token = res.NextContinuationToken;
      } while (token);
      return keys;
    },
    async deletePrefix(prefix, relativeDir) {
      const p = prefix.replace(/\/+$/, "");
      const dir = relativeDir.replace(/^\/+|\/+$/g, "");
      const fullPrefix = dir ? `${p}/${dir}/` : `${p}/`;
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: fullPrefix,
            ContinuationToken: token,
          }),
        );
        const objects = (res.Contents ?? [])
          .filter((o) => o.Key)
          .map((o) => ({ Key: o.Key! }));
        if (objects.length > 0) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects },
            }),
          );
        }
        token = res.NextContinuationToken;
      } while (token);
    },
    async exists(prefix, relativeKey) {
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: artifactObjectKey(prefix, relativeKey),
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
