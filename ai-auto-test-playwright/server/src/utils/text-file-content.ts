import fs from "node:fs/promises";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([".py", ".md", ".json", ".txt", ".toml", ".ini", ".yaml", ".yml"]);

export async function readFileContentIfText(
  absPath: string,
  relPath: string,
): Promise<{ path: string; content?: string }> {
  const ext = path.extname(relPath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    return { path: relPath };
  }
  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat || stat.size > 128 * 1024) {
    return { path: relPath };
  }
  const content = await fs.readFile(absPath, "utf8").catch(() => undefined);
  return content !== undefined ? { path: relPath, content } : { path: relPath };
}
