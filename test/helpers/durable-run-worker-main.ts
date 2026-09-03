import {
  createLegacyDecisionTruthComposition,
  laptopFixture,
} from "../fixtures/legacy-laptop-fixture.js";
import {
  createStandaloneRunWorker,
  resolveRunWorkerProcessConfig,
} from "../../src/run-worker-process.js";

const fixture = structuredClone(laptopFixture);
const firstEvidence = fixture.truthEvidence[0];
if (!firstEvidence) throw new Error("Research-needing test fixture requires at least one truth evidence profile.");
fixture.truthEvidence[0] = {
  ...firstEvidence,
  authoritativePrimary: false,
};

const config = resolveRunWorkerProcessConfig(process.env);
const worker = await createStandaloneRunWorker(config, {
  ...createLegacyDecisionTruthComposition(fixture),
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
