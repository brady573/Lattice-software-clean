import { runAlphaDecisionRunWorkerProcess } from "./decision/alpha-decision-run-worker.js";
import { assertDurableProcessSchemaReady } from "./runtime-schema-readiness.js";

try {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) await assertDurableProcessSchemaReady(databaseUrl, "run-worker");
  await runAlphaDecisionRunWorkerProcess();
} catch (error) {
  console.error("LATTICE_RUN_WORKER_START_FAILED", error);
  process.exitCode = 1;
}
