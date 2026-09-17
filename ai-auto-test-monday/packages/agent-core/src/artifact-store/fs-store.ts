import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore } from "./types.js";
import { artifactObjectKey } from "./keys.js";

export function createFsArtifactStore(baseDir: string): ArtifactStore {
  function localPath(prefix: string, relativeKey: string): string {
    return path.join(baseDir, artifactObjectKey(prefix, relativeKey));
  }

  async function walk(dir: string, base: string, out: string[]): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full, base, out);
      } else {
        out.push(path.relative(base, full).replace(/\\/g, "/"));
      }
    }
  }

  return {
    async getText(prefix, relativeKey) {
      try {
        return await readFile(localPath(prefix, relativeKey), "utf8");
      } catch {
        return null;
      }
    },
    async putText(prefix, relativeKey, content) {
      const fp = localPath(prefix, relativeKey);
      await mkdir(path.dirname(fp), { recursive: true });
      await writeFile(fp, content, "utf8");
    },
    async deleteObject(prefix, relativeKey) {
      try {
        await unlink(localPath(prefix, relativeKey));
      } catch {
        // may not exist
      }
    },
    async listRelativeKeys(prefix) {
      const root = path.join(baseDir, prefix);
      const keys: string[] = [];
      await walk(root, root, keys);
      return keys;
    },
    async deletePrefix(prefix, relativeDir) {
      const dir = path.join(baseDir, prefix, relativeDir);
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // may not exist
      }
    },
    async exists(prefix, relativeKey) {
      try {
        await access(localPath(prefix, relativeKey));
        return true;
      } catch {
        return false;
      }
    },
  };
}
