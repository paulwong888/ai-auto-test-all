import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "../../templates/project-scaffold");

export interface InitTemplateResult {
  repoPath: string;
  created: string[];
  skipped: string[];
}

export class ProjectTemplateService {
  constructor(private readonly config: AppConfig) {}

  async initTemplate(repoPath: string): Promise<InitTemplateResult> {
    const resolved = path.resolve(repoPath);
    this.assertAllowed(resolved);

    await fs.access(resolved).catch(() => {
      throw new Error(`原始碼路徑不存在: ${resolved}`);
    });

    const created: string[] = [];
    const skipped: string[] = [];

    await this.copyIfMissing(resolved, ".pi/pi-permissions.jsonc", "pi-permissions.jsonc", created, skipped);
    await this.copyIfMissing(resolved, ".pi/AGENTS.md", "AGENTS.md", created, skipped);
    await this.copyIfMissing(resolved, "playwright.config.ts", "playwright.config.ts", created, skipped);
    await this.ensureDir(resolved, "tests/e2e", created, skipped);

    return { repoPath: resolved, created, skipped };
  }

  private async copyIfMissing(
    repoPath: string,
    destRel: string,
    templateName: string,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(repoPath, destRel);
    try {
      await fs.access(dest);
      skipped.push(destRel);
      return;
    } catch {
      /* create */
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const src = path.join(TEMPLATE_DIR, templateName);
    await fs.copyFile(src, dest);
    created.push(destRel);
  }

  private async ensureDir(
    repoPath: string,
    dirRel: string,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(repoPath, dirRel);
    try {
      await fs.access(dest);
      skipped.push(dirRel + "/");
    } catch {
      await fs.mkdir(dest, { recursive: true });
      created.push(dirRel + "/");
    }
  }

  private assertAllowed(repoPath: string): void {
    const allowed = this.config.allowedRepoPrefixes.some((prefix) => {
      const p = path.resolve(prefix);
      return repoPath === p || repoPath.startsWith(p + path.sep);
    });
    if (!allowed) {
      throw new Error(
        `repoPath must be under allowed prefixes: ${this.config.allowedRepoPrefixes.join(", ")}`,
      );
    }
  }
}
