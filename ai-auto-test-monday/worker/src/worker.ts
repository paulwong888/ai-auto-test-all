import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { TASK_QUEUE } from "@monday/agent-core/workflow";
import * as activities from "./activities/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const connection = await NativeConnection.connect({ address });

  const workflowBundlePath = path.join(__dirname, "workflow-bundle.js");

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: TASK_QUEUE,
    workflowBundle: { codePath: workflowBundlePath },
    activities,
  });

  console.log(`[worker] listening on ${address} queue=${TASK_QUEUE}`);
  await worker.run();
}

run().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
