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
 * exactly once. Dispatch acknowledgement happens only after the durable Run is
 * terminal; a durable V36 research wait or execution failure releases the
 * dispatch for retry.
 */
export async function processRunDispatches(input: ProcessRunDispatchesInput): Promise<RunDispatchOutcome[]> {
  const leaseMs = input.leaseMs ?? 30_000;
  const retryDelayMs = input.retryDelayMs ?? 1_000;
  const limit = input.limit ?? 10;
  const dispatches = await input.orchestrationStore.claimDispatches({
    queueName: "lattice.run",
    workerId: input.workerId,
    now: input.now,
    leaseMs,
    limit,
  });

  const outcomes: RunDispatchOutcome[] = [];
  for (const dispatch of dispatches) {
    const before = await input.runStore.get(dispatch.runId);
    if (!before) {
      const ack = await input.orchestrationStore.acknowledgeDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        now: input.now,
      });
      outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: ack.outcome === "updated" ? "terminal" : "stale" });
      continue;
    }

    if (isTerminal(before.status)) {
      const ack = await input.orchestrationStore.acknowledgeDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        now: input.now,
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
      if (!isTerminal(completed.status)) {
        const released = await input.orchestrationStore.releaseDispatch({
          id: dispatch.id,
          workerId: input.workerId,
          availableAt: new Date(input.now.getTime() + retryDelayMs),
        });
        outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: released.outcome === "updated" ? "released" : "stale" });
        continue;
      }
      const ack = await input.orchestrationStore.acknowledgeDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        now: new Date(Math.max(input.now.getTime(), Date.now())),
      });
      outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: ack.outcome === "updated" ? "completed" : "stale" });
    } catch {
      const current = await input.runStore.get(dispatch.runId);
      if (current && isTerminal(current.status)) {
        const ack = await input.orchestrationStore.acknowledgeDispatch({
          id: dispatch.id,
          workerId: input.workerId,
          now: new Date(Math.max(input.now.getTime(), Date.now())),
        });
        outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: ack.outcome === "updated" ? "terminal" : "stale" });
        continue;
      }
      const released = await input.orchestrationStore.releaseDispatch({
        id: dispatch.id,
        workerId: input.workerId,
        availableAt: new Date(input.now.getTime() + retryDelayMs),
      });
      outcomes.push({ dispatchId: dispatch.id, runId: dispatch.runId, outcome: released.outcome === "updated" ? "released" : "stale" });
    }
  }
  return outcomes;
}
