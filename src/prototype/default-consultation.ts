import type { RunRequest } from "../domain.js";
import { createSolandraConsultationProjection } from "../presentation/solandra/consultation.js";
import { createPendingRun, executePersistedRun } from "../run-execution.js";
import type { RunStore } from "../run-store.js";
import type { TruthExecutionPipeline } from "../truth/execution-pipeline.js";

export const defaultPrototypeRequest: RunRequest = {
  goal: "Choose an option under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

export async function executeDefaultPrototypeConsultation(
  runStore: RunStore,
  truthPipeline: TruthExecutionPipeline,
) {
  const run = createPendingRun("offline-prototype-default", defaultPrototypeRequest);
  await runStore.create(run);
  const completed = await executePersistedRun(runStore, truthPipeline, run.id);
  const snapshot = await runStore.getTruthSnapshot(run.id);
  if (!snapshot || snapshot.phase !== "VALIDATED") {
    throw new Error("Completed prototype Run is missing its persisted validated V36 snapshot.");
  }
  const inputs = await truthPipeline.decisionInputs(snapshot);
  return createSolandraConsultationProjection(completed, inputs.candidates, snapshot.bundle);
}
