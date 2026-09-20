import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { query } from "../db/pool.js";
import { AppError } from "../errors.js";
import { decryptSecret, encryptSecret } from "../utils/credential-crypto.js";
import type { ProjectTemplateService } from "./project-template-service.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  return stdout.trim();
}

function isSshRepoUrl(repoUrl: string): boolean {
  return repoUrl.startsWith("git@") || repoUrl.startsWith("ssh://");
}

function authUrl(repoUrl: string, token: string): string {
  const u = new URL(repoUrl);
  u.username = "x-access-token";
  u.password = token;
  return u.toString();
}

function resolveRemoteUrl(repoUrl: string, token: string): string {
  if (isSshRepoUrl(repoUrl)) return repoUrl;
  if (!token) {
    throw new AppError("GIT_TOKEN_REQUIRED", "HTTPS repository requires a token", 422);
  }
  return authUrl(repoUrl, token);
}

const BLOCKED_PATTERNS = [/auth\.json$/i, /\.venv\//, /node_modules\//];

export class GitService {
  constructor(private readonly templateService?: ProjectTemplateService) {}

  async bindRepo(projectId: string, repoUrl: string, token: string, defaultBranch = "main") {
    if (!repoUrl) {
      throw new AppError("GIT_REPO_REQUIRED", "repoUrl is required", 422);
    }
    await query(
      `INSERT INTO git_bindings (project_id, repo_url, default_branch, encrypted_token, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (project_id) DO UPDATE SET
         repo_url = EXCLUDED.repo_url,
         default_branch = EXCLUDED.default_branch,
         encrypted_token = EXCLUDED.encrypted_token,
         updated_at = NOW()`,
      [projectId, repoUrl, defaultBranch, encryptSecret(token)],
    );
  }

  async getBinding(projectId: string): Promise<{
    repoUrl: string;
    defaultBranch: string;
    encryptedToken: string;
  } | null> {
    const result = await query<{ repo_url: string; default_branch: string; encrypted_token: string }>(
      `SELECT repo_url, default_branch, encrypted_token FROM git_bindings WHERE project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      repoUrl: row.repo_url,
      defaultBranch: row.default_branch,
      encryptedToken: row.encrypted_token,
    };
  }

  async sync(workspacePath: string, projectId: string, baseUrl: string): Promise<void> {
    const binding = await this.getBinding(projectId);
    if (!binding) {
      throw new AppError("GIT_NOT_BOUND", "Git repository not bound", 422);
    }
    const token = decryptSecret(binding.encryptedToken);
    const url = resolveRemoteUrl(binding.repoUrl, token);
    const gitDir = path.join(workspacePath, ".git");
    const hasGit = await fs.access(gitDir).then(() => true).catch(() => false);
    if (!hasGit) {
      await fs.mkdir(path.dirname(workspacePath), { recursive: true }).catch(() => undefined);
      const entries = await fs.readdir(workspacePath).catch(() => [] as string[]);
      if (entries.length > 0) {
        throw new AppError("GIT_WORKSPACE_NOT_EMPTY", "Workspace must be empty before git clone", 422);
      }
      await execFileAsync("git", ["clone", url, workspacePath], {
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      });
    } else {
      await git(workspacePath, ["remote", "set-url", "origin", url]);
      await git(workspacePath, ["fetch", "origin"]);
      await git(workspacePath, ["checkout", binding.defaultBranch]).catch(() => undefined);
      await git(workspacePath, ["pull", "origin", binding.defaultBranch]).catch(() => undefined);
    }

    const testsDir = path.join(workspacePath, "tests");
    const hasTests = await fs.access(testsDir).then(() => true).catch(() => false);
    if (!hasTests) {
      if (!this.templateService) {
        throw new AppError("TESTS_MISSING", "Cloned repo missing tests/ directory", 422);
      }
      await this.templateService.initTemplate(workspacePath, baseUrl);
    }
  }

  async push(workspacePath: string, projectId: string, message: string): Promise<{ branch: string }> {
    const binding = await this.getBinding(projectId);
    if (!binding) throw new AppError("GIT_NOT_BOUND", "Git not bound", 422);

    const status = await git(workspacePath, ["status", "--porcelain", "tests/"]);
    if (!status.trim()) {
      throw new AppError("GIT_NOTHING_TO_COMMIT", "No changes under tests/ to commit", 422);
    }
    for (const line of status.split("\n")) {
      const file = line.slice(3).trim();
      if (BLOCKED_PATTERNS.some((re) => re.test(file))) {
        throw new AppError("GIT_BLOCKED_FILE", `Refusing to commit blocked file: ${file}`, 422);
      }
    }

    const branch = `e2e/${Date.now()}`;
    await git(workspacePath, ["config", "user.email", "e2e@ai-auto-test.local"]);
    await git(workspacePath, ["config", "user.name", "ai-auto-test-playwright"]);
    await git(workspacePath, ["checkout", "-b", branch]);
    await git(workspacePath, ["add", "tests/"]);
    await git(workspacePath, ["commit", "-m", message]);
    const token = decryptSecret(binding.encryptedToken);
    const remoteUrl = resolveRemoteUrl(binding.repoUrl, token);
    await git(workspacePath, ["remote", "set-url", "origin", remoteUrl]);
    await git(workspacePath, ["push", "-u", "origin", branch]);
    return { branch };
  }

  async createPullRequest(projectId: string, branch: string, title: string): Promise<{ url: string }> {
    const binding = await this.getBinding(projectId);
    if (!binding) throw new AppError("GIT_NOT_BOUND", "Git not bound", 422);
    const token = decryptSecret(binding.encryptedToken);
    if (!token) {
      throw new AppError("PR_TOKEN_REQUIRED", "PR creation requires an HTTPS token", 422);
    }
    const match = binding.repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) {
      throw new AppError("PR_UNSUPPORTED", "PR creation only supported for GitHub repos", 422);
    }
    const [, owner, repo] = match;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, head: branch, base: binding.defaultBranch, body: "Automated E2E test push" }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AppError("PR_FAILED", `GitHub PR failed: ${text}`, 502);
    }
    const data = (await res.json()) as { html_url: string };
    return { url: data.html_url };
  }
}
