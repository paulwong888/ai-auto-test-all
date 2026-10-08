import { bundleWorkflowCode } from "@temporalio/worker";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, "dist");
const outFile = path.join(outDir, "workflow-bundle.js");

await mkdir(outDir, { recursive: true });

const { code } = await bundleWorkflowCode({
  workflowsPath: path.join(root, "src", "workflows"),
});

await writeFile(outFile, code);
console.log("[temporal-worker] workflow bundle written:", outFile);
