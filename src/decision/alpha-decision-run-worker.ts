import { createAlphaDecisionWorkerComposition } from "./alpha-decision-composition.js";
import {
  createStandaloneRunWorker,
  resolveRunWorkerProcessConfig,
} from "../run-worker-process.js";

/**
 * Canonical process entry for the existing durable Run worker with the same A3
 * decision dependencies used by the API composition. This does not add a worker
 * role or queue; it only supplies the already-supported catalog/evidence seams.
 */
export async function runAlphaDecisionRunWorkerProcess(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = resolveRunWorkerProcessConfig(env);
  const worker = await createStandaloneRunWorker(config, {
    ...createAlphaDecisionWorkerComposition(),
    onPollError(error): void {
      console.error("LATTICE_RUN_WORKER_POLL_FAILED", error);
    },
  });

  let resolveStop: ((signal: NodeJS.Signals) => void) | undefined;
  const stopRequested = new Promise<NodeJS.Signals>((resolve) => {
    resolveStop = resolve;
  });
  const onSigint = (): void => resolveStop?.("SIGINT");
  const onSigterm = (): void => resolveStop?.("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    worker.start();
    console.log(`LATTICE_RUN_WORKER_READY workerId=${config.workerId}`);
    const signal = await stopRequested;
    console.log(`LATTICE_RUN_WORKER_STOPPING signal=${signal}`);
    await worker.close();
    console.log(`LATTICE_RUN_WORKER_STOPPED signal=${signal}`);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await worker.close();
  }
}
