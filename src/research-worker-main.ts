import { runStandaloneResearchWorkerProcess } from "./research-worker-process.js";
import { assertDurableProcessSchemaReady } from "./runtime-schema-readiness.js";

try {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) await assertDurableProcessSchemaReady(databaseUrl, "research-worker");
  await runStandaloneResearchWorkerProcess();
} catch (error) {
  console.error("LATTICE_RESEARCH_WORKER_START_FAILED", error);
  process.exitCode = 1;
}
