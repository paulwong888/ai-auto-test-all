import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config.js";
import type { AuthMode } from "../schemas/project.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "../../templates/project-scaffold");

const GITIGNORE_LINES = [".env.e2e", "tests/e2e/.auth/", ".pi/run-history.json"];

export interface InitTemplateOptions {
  targetUrl: string;
  authMode?: AuthMode;
  e2eUsername?: string;
  e2ePassword?: string;
}

export interface InitTemplateResult {
  repoPath: string;
  created: string[];
  skipped: string[];
  warnings: string[];
}

export class ProjectTemplateService {
  constructor(private readonly config: AppConfig) {}

  async initTemplate(
    repoPath: string,
    options: InitTemplateOptions = { targetUrl: this.config.defaultTargetAppUrl },
  ): Promise<InitTemplateResult> {
    const resolved = path.resolve(repoPath);
    this.assertAllowed(resolved);

    await fs.access(resolved).catch(() => {
      throw new Error(`原始碼路徑不存在: ${resolved}`);
    });

    const created: string[] = [];
    const skipped: string[] = [];
    const warnings: string[] = [];
    const authMode = options.authMode ?? "none";
    const targetUrl = options.targetUrl;

    await this.copyIfMissing(resolved, ".pi/pi-permissions.jsonc", "pi-permissions.jsonc", created, skipped);
    await this.copyIfMissing(resolved, ".pi/AGENTS.md", "AGENTS.md", created, skipped);
    await this.copyIfMissing(resolved, ".pi/.gitkeep", ".pi/.gitkeep", created, skipped);
    await this.ensureDir(resolved, "tests/e2e", created, skipped);
    await this.copyIfMissing(resolved, "tests/e2e/.gitkeep", "tests/e2e/.gitkeep", created, skipped);

    const playwrightTemplate =
      authMode === "keycloak" ? "playwright.config.keycloak.ts" : "playwright.config.ts";
    await this.writeFromTemplate(
      resolved,
      "playwright.config.ts",
      playwrightTemplate,
      { __TARGET_URL__: targetUrl },
      created,
      skipped,
    );

    await this.writeFromTemplate(
      resolved,
      ".env.e2e.example",
      "env.e2e.example",
      { __TARGET_URL__: targetUrl },
      created,
      skipped,
    );

    if (authMode === "keycloak") {
      await this.writeFromTemplate(
        resolved,
        "tests/e2e/auth.setup.ts",
        "auth.setup.keycloak.ts",
        { __TARGET_URL__: targetUrl },
        created,
        skipped,
      );

      if (options.e2eUsername && options.e2ePassword) {
        await this.writeEnvE2e(resolved, targetUrl, options.e2eUsername, options.e2ePassword, created, skipped);
      } else {
        await this.writePlaywrightBaseUrlEnv(resolved, targetUrl, created, skipped);
        warnings.push("未提供 SSO 帳密，請手動建立 .env.e2e");
      }
    } else {
      await this.writePlaywrightBaseUrlEnv(resolved, targetUrl, created, skipped);
    }

    await this.mergeGitignore(resolved, created, skipped);

    if (authMode === "keycloak") {
      warnings.push(
        "Keycloak 專案請確認 targetUrl 已在 SSO 客戶端登記為合法 redirect_uri",
      );
    }

    return { repoPath: resolved, created, skipped, warnings };
  }

  private async writeFromTemplate(
    repoPath: string,
    destRel: string,
    templateName: string,
    vars: Record<string, string>,
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
    let content = await fs.readFile(path.join(TEMPLATE_DIR, templateName), "utf8");
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(key, value);
    }
    await fs.writeFile(dest, content);
    created.push(destRel);
  }

  private async writePlaywrightBaseUrlEnv(
    repoPath: string,
    targetUrl: string,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(repoPath, ".env.e2e");
    try {
      await fs.access(dest);
      skipped.push(".env.e2e");
      return;
    } catch {
      /* create */
    }

    await fs.writeFile(dest, `PLAYWRIGHT_BASE_URL=${targetUrl}\n`);
    created.push(".env.e2e");
  }

  private async writeEnvE2e(
    repoPath: string,
    targetUrl: string,
    username: string,
    password: string,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(repoPath, ".env.e2e");
    try {
      await fs.access(dest);
      skipped.push(".env.e2e");
      return;
    } catch {
      /* create */
    }

    const content = [
      `PLAYWRIGHT_BASE_URL=${targetUrl}`,
      `E2E_USERNAME=${username}`,
      `E2E_PASSWORD=${password}`,
      "",
    ].join("\n");
    await fs.writeFile(dest, content);
    created.push(".env.e2e");
  }

  private async mergeGitignore(
    repoPath: string,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(repoPath, ".gitignore");
    let existing = "";
    try {
      existing = await fs.readFile(dest, "utf8");
    } catch {
      /* new file */
    }

    const lines = existing.split("\n");
    const toAdd = GITIGNORE_LINES.filter(
      (line) => !lines.some((l) => l.trim() === line),
    );
    if (toAdd.length === 0) {
      if (existing) skipped.push(".gitignore");
      return;
    }

    const suffix = existing && !existing.endsWith("\n") ? "\n" : "";
    const block = `${existing ? existing + suffix : ""}${toAdd.join("\n")}\n`;
    await fs.writeFile(dest, block);
    created.push(".gitignore");
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
