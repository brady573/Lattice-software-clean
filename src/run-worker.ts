import type { DurableOrchestrationStore } from "./orchestration-store.js";
import type { RunStore } from "./run-store.js";
import {
  executePersistedRun,
  type DurableV36ContinuationBridge,
  type GeneralizedDecisionAdapter,
} from "./run-execution.js";
import type { TruthExecutionPipeline } from "./truth/execution-pipeline.js";
import type { DecisionEvidenceProvider } from "./truth/decision-evidence-provider.js";

export interface ProcessRunDispatchesInput {
  runStore: RunStore;
  orchestrationStore: DurableOrchestrationStore;
  truthPipeline: TruthExecutionPipeline;
  continuationBridge?: DurableV36ContinuationBridge;
  generalizedDecisionAdapter?: GeneralizedDecisionAdapter;
  decisionEvidenceProvider?: DecisionEvidenceProvider;
  workerId: string;
  now: Date;
  leaseMs?: number;
  retryDelayMs?: number;
  limit?: number;
  clock?: () => Date;
}

export interface RunDispatchOutcome {
  dispatchId: number;
  runId: string;
  outcome: "completed" | "terminal" | "released" | "stale";
}

function isTerminal(status: string): boolean {
  return status === "COMPLETED" || status === "CANCELLED" || status === "FAILED";
}

/**
 * Consume at-least-once `lattice.run` dispatches. Correctness is provided by
 * the Run executor's status/version CAS, not by assuming queue delivery is
 * exactly once. Work is claimed immediately before local execution so a
 * serial backlog is never pre-leased past its usable ownership window.
 */
export async function processRunDispatches(input: ProcessRunDispatchesInput): Promise<RunDispatchOutcome[]> {
  const leaseMs = input.leaseMs ?? 30_000;
  const retryDelayMs = input.retryDelayMs ?? 1_000;
  const limit = input.limit ?? 10;
  const clock = input.clock ?? (() => new Date(Math.max(input.now.getTime(), Date.now())));
  const outcomes: RunDispatchOutcome[] = [];

  for (let processed = 0; processed < limit; processed += 1) {
    const claimTime = clock();
    const dispatch = (await input.orchestrationStore.claimDispatches({
      queueName: "lattice.run",
      workerId: input.workerId,
      now: claimTime,
      leaseMs,
      limit: 1,
    }))[0];
    if (!dispatch) break;

    const before = await input.runStore.get(dispatch.runId);
    if (!before) {
      const ack = await input.orchestrationStore.acknowledgeDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        now: clock(),
      });
      outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: ack.outcome === "updated" ? "terminal" : "stale" });
      continue;
    }

    if (isTerminal(before.status)) {
      const ack = await input.orchestrationStore.acknowledgeDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        now: clock(),
      });
      outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: ack.outcome === "updated" ? "terminal" : "stale" });
      continue;
    }

    try {
      const completed = await executePersistedRun(
        input.runStore,
        input.truthPipeline,
        dispatch.runId,
        input.continuationBridge,
        input.generalizedDecisionAdapter,
        input.decisionEvidenceProvider,
      );
      const mutationTime = clock();
      if (!isTerminal(completed.status)) {
        const released = await input.orchestrationStore.releaseDispatch({
          id: dispatch.id,
          workerId: input.workerId,
          now: mutationTime,
          availableAt: new Date(mutationTime.getTime() + retryDelayMs),
        });
        outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: released.outcome === "updated" ? "released" : "stale" });
        continue;
      }
      const ack = await input.orchestrationStore.acknowledgeDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        now: mutationTime,
      });
      outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: ack.outcome === "updated" ? "completed" : "stale" });
    } catch {
      const current = await input.runStore.get(dispatch.runId);
      const mutationTime = clock();
      if (current && isTerminal(current.status)) {
        const ack = await input.orchestrationStore.acknowledgeDispatch({
          id: dispatch.id,
          workerId: input.workerId,
          now: mutationTime,
        });
        outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: ack.outcome === "updated" ? "terminal" : "stale" });
        continue;
      }
      const released = await input.orchestrationStore.releaseDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        now: mutationTime,
        availableAt: new Date(mutationTime.getTime() + retryDelayMs),
      });
      outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: released.outcome === "updated" ? "released" : "stale" });
    }
  }
  return outcomes;
}
