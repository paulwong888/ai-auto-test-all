import { Router } from "express";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { runPipelineSchema } from "@monday/agent-core";
import {
  getPipelineRun,
  listRuns,
  startPipeline,
} from "../services/pipeline-service.js";

const ARTIFACT_FILES: Record<string, string> = {
  registry: "component-registry.json",
  injections: "testid-injections.json",
  locators: "locator-catalog.json",
  journeys: "journeys.json",
};

const ARTIFACT_TEXT_FILES: Record<string, string> = {
  "sample-spec": path.join("tests", "sample.spec.ts"),
};

async function listArtifactFiles(artifactRoot: string): Promise<
  Array<{ key: string; label: string; kind: "json" | "text" }>
> {
  const items: Array<{ key: string; label: string; kind: "json" | "text" }> = [
    { key: "registry", label: "component-registry.json", kind: "json" },
    { key: "injections", label: "testid-injections.json", kind: "json" },
    { key: "locators", label: "locator-catalog.json", kind: "json" },
    { key: "journeys", label: "journeys.json", kind: "json" },
    { key: "sample-spec", label: "tests/sample.spec.ts", kind: "text" },
  ];

  const pomDir = path.join(artifactRoot, "poms");
  try {
    const poms = await readdir(pomDir);
    for (const file of poms.filter((f) => f.endsWith(".ts"))) {
      items.push({
        key: `pom-${file}`,
        label: `poms/${file}`,
        kind: "text",
      });
    }
  } catch {
    // no poms yet
  }

  return items;
}

export function createPipelineRouter(): Router {
  const router = Router();

  router.post("/run", async (req, res) => {
    const parsed = runPipelineSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await startPipeline(parsed.data.projectId);
      res.status(202).json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not ready") ? 400 : 500;
      res.status(status).json({ ok: false, error: message });
    }
  });

  router.get("/runs", async (req, res) => {
    const projectId =
      typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const runs = await listRuns(projectId);
    res.json({ ok: true, runs });
  });

  router.get("/runs/:runId", async (req, res) => {
    try {
      const data = await getPipelineRun(req.params.runId);
      res.json({ ok: true, ...data });
    } catch (err) {
      res.status(404).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/runs/:runId/artifacts/list", async (req, res) => {
    try {
      const { run } = await getPipelineRun(req.params.runId);
      const artifactRoot = String(run.artifact_root);
      const files = await listArtifactFiles(artifactRoot);
      res.json({ ok: true, files });
    } catch (err) {
      res.status(404).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/runs/:runId/artifacts/:name", async (req, res) => {
    try {
      const { run } = await getPipelineRun(req.params.runId);
      const artifactRoot = String(run.artifact_root);
      const name = req.params.name;

      if (name.startsWith("pom-")) {
        const fileName = name.slice(4);
        const filePath = path.join(artifactRoot, "poms", fileName);
        const content = await readFile(filePath, "utf8");
        res.type("text/plain").send(content);
        return;
      }

      const textRel = ARTIFACT_TEXT_FILES[name];
      if (textRel) {
        const content = await readFile(path.join(artifactRoot, textRel), "utf8");
        res.type("text/plain").send(content);
        return;
      }

      const file = ARTIFACT_FILES[name];
      if (!file) {
        res.status(404).json({ ok: false, error: "unknown artifact name" });
        return;
      }
      const content = await readFile(path.join(artifactRoot, file), "utf8");
      res.type("application/json").send(content);
    } catch (err) {
      res.status(404).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return router;
}
