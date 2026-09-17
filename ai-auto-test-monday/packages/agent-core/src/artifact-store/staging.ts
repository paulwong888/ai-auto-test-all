import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore } from "./types.js";

export async function pullToLocal(
  store: ArtifactStore,
  prefix: string,
  localDir: string,
): Promise<void> {
  await mkdir(localDir, { recursive: true });
  const keys = await store.listRelativeKeys(prefix);
  for (const key of keys) {
    const content = await store.getText(prefix, key);
    if (content == null) continue;
    const dest = path.join(localDir, key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
  }
}

export async function pushFromLocal(
  store: ArtifactStore,
  prefix: string,
  localDir: string,
): Promise<void> {
  const keys = await listLocalFiles(localDir, localDir);
  for (const key of keys) {
    const content = await readFile(path.join(localDir, key), "utf8");
    await store.putText(prefix, key, content);
  }
}

async function listLocalFiles(dir: string, root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      out.push(...(await listLocalFiles(full, root)));
    } else {
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

export async function removeLocalStaging(localDir: string): Promise<void> {
  try {
    await rm(localDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
