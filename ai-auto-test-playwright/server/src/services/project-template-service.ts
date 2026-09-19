import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../errors.js";
import type { AppConfig } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "../../../templates/project-scaffold");

const SCAFFOLD_DIRS = [
  "specs",
  "pages",
  "data",
  "fixtures",
  "plans",
  "recorded",
  "helpers",
];

export interface InitTemplateResult {
  workspacePath: string;
  testsRoot: string;
  created: string[];
  skipped: string[];
}

export class ProjectTemplateService {
  constructor(private readonly config: AppConfig) {}

  async initTemplate(workspacePath: string, baseUrl: string): Promise<InitTemplateResult> {
    const resolved = this.assertAllowed(path.resolve(workspacePath));
    await fs.mkdir(resolved, { recursive: true });

    const testsRoot = path.join(resolved, "tests");
    const created: string[] = [];
    const skipped: string[] = [];

    await fs.mkdir(testsRoot, { recursive: true });

    await this.copyIfMissing(testsRoot, "conftest.py", "conftest.py", { __BASE_URL__: baseUrl }, created, skipped);
    await this.copyIfMissing(testsRoot, "pytest.ini", "pytest.ini", {}, created, skipped);
    await this.copyIfMissing(testsRoot, "requirements.txt", "requirements.txt", {}, created, skipped);
    await this.copyIfMissing(testsRoot, ".gitignore", ".gitignore", {}, created, skipped);
    await this.copyIfMissing(
      testsRoot,
      "helpers/trace_support.py",
      "helpers/trace_support.py",
      {},
      created,
      skipped,
    );
    await this.copyIfMissing(testsRoot, ".pi/AGENTS.md", ".pi/AGENTS.md", {}, created, skipped);

    for (const dir of SCAFFOLD_DIRS) {
      await this.ensureDir(testsRoot, dir, created, skipped);
      if (dir !== "helpers") {
        await this.ensureGitkeep(testsRoot, dir, created, skipped);
      }
    }

    return { workspacePath: resolved, testsRoot, created, skipped };
  }

  private async copyIfMissing(
    testsRoot: string,
    destRel: string,
    templateName: string,
    vars: Record<string, string>,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(testsRoot, destRel);
    try {
      await fs.access(dest);
      skipped.push(`tests/${destRel}`);
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
    created.push(`tests/${destRel}`);
  }

  private async ensureDir(
    testsRoot: string,
    dirRel: string,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(testsRoot, dirRel);
    try {
      await fs.access(dest);
      skipped.push(`tests/${dirRel}/`);
    } catch {
      await fs.mkdir(dest, { recursive: true });
      created.push(`tests/${dirRel}/`);
    }
  }

  private async ensureGitkeep(
    testsRoot: string,
    dirRel: string,
    created: string[],
    skipped: string[],
  ): Promise<void> {
    const dest = path.join(testsRoot, dirRel, ".gitkeep");
    try {
      await fs.access(dest);
      skipped.push(`tests/${dirRel}/.gitkeep`);
    } catch {
      await fs.writeFile(dest, "");
      created.push(`tests/${dirRel}/.gitkeep`);
    }
  }

  private assertAllowed(workspacePath: string): string {
    const allowed = this.config.allowedRepoPrefixes.some(
      (prefix) => workspacePath === prefix || workspacePath.startsWith(`${prefix}${path.sep}`),
    );
    if (!allowed) {
      throw new AppError(
        "INVALID_WORKSPACE",
        `workspacePath must be under allowed prefixes: ${this.config.allowedRepoPrefixes.join(", ")}`,
        422,
      );
    }
    return workspacePath;
  }
}
