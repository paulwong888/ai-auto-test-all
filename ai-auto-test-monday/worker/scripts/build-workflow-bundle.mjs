import { bundleWorkflowCode } from "@temporalio/worker";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "dist");
const outFile = path.join(outDir, "workflow-bundle.js");
const agentCoreWorkflow = path.join(
  root,
  "..",
  "packages",
  "agent-core",
  "dist",
  "workflow.js",
);

await mkdir(outDir, { recursive: true });

const { code } = await bundleWorkflowCode({
  workflowsPath: path.join(root, "src", "workflows"),
  webpackConfigHook: (config) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@monday/agent-core/workflow": agentCoreWorkflow,
    };
    return config;
  },
});

await writeFile(outFile, code);
console.log("[worker] workflow bundle written:", outFile);
