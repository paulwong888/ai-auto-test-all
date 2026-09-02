import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { slugify, uniqueProjectId } from "../schemas/project.js";
import { ProjectService } from "./project-service.js";
import type { AppConfig } from "../config.js";
import { InMemoryProjectStore } from "../test/in-memory-stores.js";

function makeConfig(baseDir: string): AppConfig {
  const sandbox = path.join(baseDir, "sandbox-repos");
  const external = path.join(baseDir, "external-repos");
  return {
    host: "127.0.0.1",
    port: 3001,
    piCliPath: "pi",
    defaultSandboxRepo: path.join(sandbox, "demo-app"),
    defaultTargetAppUrl: "http://localhost:8037",
    postgres: {
      host: "127.0.0.1",
      port: 5433,
      database: "test",
      user: "postgres",
      password: "postgres",
    },
    legacyProjectsFile: path.join(baseDir, "platform", "projects.json"),
    legacyAuditJobsDir: path.join(baseDir, "platform", "audit-jobs"),
    allowedRepoPrefixes: [sandbox, external],
    sandboxReposContainerPath: sandbox,
    externalReposContainerPath: external,
    piRpcArgs: ["--no-session"],
    piRunSkillName: "e2e-test-env",
    piRunSkillPath: "",
    auditTimeoutMs: 600_000,
    auditModuleTimeoutMs: 600_000,
    auditFullEnabled: true,
    auditProfilesDir: path.join(baseDir, "audit-profiles"),
    runTimeoutMs: 900_000,
    runMaxPlaywrightAttempts: 3,
    runReferenceSpecLimit: 3,
    get playwrightCliPath() {
      return path.join(sandbox, "demo-app/node_modules/@playwright/test/cli.js");
    },
    get playwrightNodePath() {
      return path.join(sandbox, "demo-app/node_modules");
    },
  } as AppConfig;
}

describe("project schema helpers", () => {
  it("slugify normalizes names", () => {
    assert.equal(slugify("Demo App"), "demo-app");
    assert.equal(slugify("  My Project!!  "), "my-project");
  });

  it("uniqueProjectId avoids collisions", () => {
    const existing = new Set(["demo-app", "demo-app-2"]);
    assert.equal(uniqueProjectId("demo-app", existing), "demo-app-3");
  });
});

describe("ProjectService", () => {
  let tmpDir: string;
  let service: ProjectService;
  let config: AppConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-service-"));
    config = makeConfig(tmpDir);
    await fs.mkdir(config.allowedRepoPrefixes[0]!, { recursive: true });
    await fs.mkdir(config.allowedRepoPrefixes[1]!, { recursive: true });
    service = new ProjectService(config, new InMemoryProjectStore());
    await service.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("seeds demo-app on first init", async () => {
    const projects = await service.list();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]!.id, "demo-app");
  });

  it("creates project with allowed repo path", async () => {
    const repoPath = path.join(config.allowedRepoPrefixes[0]!, "my-app");
    await fs.mkdir(repoPath, { recursive: true });
    const project = await service.create({
      name: "My App",
      repoPath,
      targetUrl: "http://localhost:9000",
    });
    assert.equal(project.id, "my-app");
    assert.equal(project.repoPath, repoPath);
  });

  it("rejects repo path outside whitelist", async () => {
    await assert.rejects(
      () =>
        service.create({
          name: "Bad",
          repoPath: "/etc/passwd",
          targetUrl: "http://localhost:9000",
        }),
      /allowed prefixes/,
    );
  });

  it("updates and deletes projects", async () => {
    const repoPath = path.join(config.allowedRepoPrefixes[1]!, "frontend");
    await fs.mkdir(repoPath, { recursive: true });
    const created = await service.create({
      name: "Frontend",
      repoPath,
      targetUrl: "http://localhost:8080",
    });
    const updated = await service.update(created.id, { name: "Frontend v2" });
    assert.equal(updated.name, "Frontend v2");
    await service.remove(created.id);
    const list = await service.list();
    assert.equal(list.some((p) => p.id === created.id), false);
  });

  it("resolve returns project paths", async () => {
    const resolved = await service.resolve("demo-app");
    assert.equal(resolved.repoPath, path.resolve(config.defaultSandboxRepo));
    assert.equal(resolved.targetUrl, config.defaultTargetAppUrl);
  });
});
