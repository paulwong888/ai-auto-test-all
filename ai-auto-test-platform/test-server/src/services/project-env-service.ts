import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";
import { buildPlaywrightTestCommand } from "./playwright-runner.js";

const execFileAsync = promisify(execFile);

export interface EnsureTestEnvResult {
  ok: boolean;
  message: string;
}

export class ProjectEnvService {
  constructor(private readonly config: AppConfig) {}

  async ensureTestEnv(repoPath: string, targetUrl: string): Promise<EnsureTestEnvResult> {
    const resolved = path.resolve(repoPath);

    try {
      await fs.access(path.join(resolved, "playwright.config.ts"));
    } catch {
      return {
        ok: false,
        message: "缺少 playwright.config.ts，請在專案管理執行「初始化模板」",
      };
    }

    try {
      await fs.access(path.join(resolved, "tests/e2e"));
    } catch {
      return {
        ok: false,
        message: "缺少 tests/e2e/ 目錄，請在專案管理執行「初始化模板」",
      };
    }

    const listCmd = buildPlaywrightTestCommand(
      this.config,
      resolved,
      targetUrl,
      "tests/e2e",
      "--list",
    );

    try {
      await execFileAsync("bash", ["-lc", listCmd], {
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return { ok: true, message: "Playwright 環境就緒" };
    } catch (err) {
      const detail =
        err instanceof Error && "stderr" in err
          ? String((err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err.message)
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        ok: false,
        message: `Playwright 環境檢查失敗：${detail.slice(0, 500)}`,
      };
    }
  }
}
