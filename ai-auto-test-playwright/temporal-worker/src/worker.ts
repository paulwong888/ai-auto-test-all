import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { PLAYWRIGHT_PLATFORM_TASK_QUEUE } from "./shared/workflow-types.js";
import * as activities from "./activities/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? "172.26.9.212:7233";
  const connection = await NativeConnection.connect({ address });
  const workflowBundlePath = path.join(__dirname, "workflow-bundle.js");

  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? PLAYWRIGHT_PLATFORM_TASK_QUEUE,
    workflowBundle: { codePath: workflowBundlePath },
    activities,
  });

  console.log(
    `[temporal-worker] listening address=${address} queue=${process.env.TEMPORAL_TASK_QUEUE ?? PLAYWRIGHT_PLATFORM_TASK_QUEUE}`,
  );
  await worker.run();
}

run().catch((err) => {
  console.error("[temporal-worker] fatal", err);
  process.exit(1);
});
