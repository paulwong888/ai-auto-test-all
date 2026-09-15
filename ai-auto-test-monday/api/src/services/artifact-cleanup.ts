import { readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "@monday/agent-core/workflow";

const DOWNSTREAM_FILES: Partial<Record<AgentId, string[]>> = {
  scriptAnalyst: [
    "testid-injections.json",
    "locator-catalog.json",
    "journeys.json",
    "execution-report.json",
    "apply-report.json",
  ],
  stageManager: [
    "locator-catalog.json",
    "journeys.json",
    "execution-report.json",
  ],
  blockingCoach: ["journeys.json", "execution-report.json"],
  setDesigner: ["journeys.json", "execution-report.json"],
  choreographer: ["execution-report.json"],
  assistantDirector: ["execution-report.json"],
  continuityLead: ["execution-report.json"],
};

const DOWNSTREAM_DIRS: Partial<Record<AgentId, string[]>> = {
  scriptAnalyst: ["poms", "tests"],
  stageManager: ["poms", "tests"],
  blockingCoach: ["poms", "tests"],
  setDesigner: ["poms", "tests"],
  choreographer: ["tests"],
  assistantDirector: ["tests"],
};

export async function cleanupDownstreamArtifacts(
  artifactRoot: string,
  fromAgent: AgentId,
): Promise<void> {
  for (const file of DOWNSTREAM_FILES[fromAgent] ?? []) {
    try {
      await unlink(path.join(artifactRoot, file));
    } catch {
      // file may not exist
    }
  }

  for (const dir of DOWNSTREAM_DIRS[fromAgent] ?? []) {
    try {
      await rm(path.join(artifactRoot, dir), { recursive: true, force: true });
    } catch {
      // directory may not exist
    }
  }

  if (fromAgent === "assistantDirector") {
    const testsDir = path.join(artifactRoot, "tests");
    try {
      const specs = await readdir(testsDir);
      await Promise.all(
        specs
          .filter((f) => f.endsWith(".spec.ts"))
          .map((f) => unlink(path.join(testsDir, f)).catch(() => {})),
      );
    } catch {
      // no tests dir
    }
  }
}
