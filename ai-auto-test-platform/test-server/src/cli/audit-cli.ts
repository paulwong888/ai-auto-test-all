#!/usr/bin/env node
/**
 * CLI：独立触发沙箱审计（不启动 HTTP 服务）
 * Usage: npm run audit -w test-server [-- --repo /path/to/repo] [-- --project-id demo-app]
 */
import path from "node:path";
import { config } from "../config.js";
import { AuditService } from "../services/audit-service.js";
import { ProjectService } from "../services/project-service.js";

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function parseRepoArg(): string | undefined {
  const value = parseArg("--repo");
  return value ? path.resolve(value) : undefined;
}

async function main(): Promise<void> {
  const repoPath = parseRepoArg();
  const projectId = parseArg("--project-id");
  const projectService = new ProjectService(config);
  await projectService.init();
  const service = new AuditService(config, projectService);

  console.log(`[audit-cli] project: ${projectId ?? "(none)"}`);
  console.log(`[audit-cli] repo: ${repoPath ?? config.defaultSandboxRepo}`);
  console.log(`[audit-cli] pi: ${config.piCliPath}`);

  const result = await service.runAudit({
    projectId,
    repoPath,
    onProgress: (event) => {
      switch (event.kind) {
        case "pi_spawned":
          console.log(`[audit-cli] Pi Agent spawned (pid ${event.pid})`);
          break;
        case "tool_start":
          console.log(`[audit-cli] tool → ${event.toolName}`, event.args);
          break;
        case "tool_end":
          console.log(`[audit-cli] tool ✓ ${event.toolName}${event.isError ? " (error)" : ""}`);
          break;
        case "text_delta":
          process.stdout.write(event.delta);
          break;
        case "agent_settled":
          console.log("\n[audit-cli] agent settled");
          break;
        case "completed":
          console.log(`\n[audit-cli] done → ${event.featuresPath} (${event.featureCount} features)`);
          break;
        case "error":
          console.error(`[audit-cli] error: ${event.message}`);
          break;
        default:
          break;
      }
    },
  });

  console.log(JSON.stringify(result.features, null, 2));
}

main().catch((err) => {
  console.error("[audit-cli] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
