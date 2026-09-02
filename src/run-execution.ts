import { randomUUID } from "node:crypto";
import {
  isConsultationRunRequest,
  type LatticeRun,
  type LatticeRunRequest,
  type RunStatus,
} from "./domain.js";
import { createDecisionFromAdmittedEvidence } from "./engine.js";
import {
  assertSolandraExplanationFidelity,
  createSolandraExplanationPlan,
  renderCanonicalExplanation,
} from "./presentation/solandra/index.js";
import type { RunStore } from "./run-store.js";
import { materializeDecisionEvidence } from "./truth/admission.js";
import type {
  TruthDurableValidationStep,
  TruthExecutionPipeline,
} from "./truth/execution-pipeline.js";
import { assertDecisionTruthFidelity } from "./truth/fidelity.js";
import type { TruthSnapshot } from "./truth/snapshot.js";
import type { PostgresV36ResearchBridge } from "./v36-research-bridge.js";

const terminalStatuses = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);

function isSettledStatus(status: RunStatus): boolean {
  return terminalStatuses.has(status) || status === "AWAITING_CLARIFICATION";
}

function requiresDecision(request: LatticeRunRequest): boolean {
  return !isConsultationRunRequest(request) || request.decisionNeed === "QUALIFIED";
}

export type DurableV36ContinuationBridge = Pick<PostgresV36ResearchBridge, "load" | "schedule">;
type DurableTruthExecutionPipeline = TruthExecutionPipeline & Required<Pick<
  TruthExecutionPipeline,
  "beginDurableValidation" | "resumeDurableValidation"
>>;

function requireDurableTruthPipeline(pipeline: TruthExecutionPipeline): DurableTruthExecutionPipeline {
  if (!pipeline.beginDurableValidation || !pipeline.resumeDurableValidation) {
    throw new Error("Durable V36 continuation requires explicit begin/resume truth-pipeline capabilities.");
  }
  return pipeline as DurableTruthExecutionPipeline;
}

export function createPendingRun(
  conversationId: string,
  request: LatticeRunRequest,
  runId = randomUUID(),
): LatticeRun {
  return {
    id: runId,
    conversationId,
    status: "CREATED",
    version: 1,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [{ sequence: 1, type: "CREATED" }],
  };
}

class LostRunOwnershipError extends Error {}

export class RunExecutionError extends Error {
  constructor(
    message: string,
    readonly runId: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

async function advanceDurableValidation(
  input: {
    bridge: DurableV36ContinuationBridge;
    truthPipeline: DurableTruthExecutionPipeline;
    runId: string;
    status: RunStatus;
    version: number;
    initial: TruthDurableValidationStep;
  },
): Promise<{ outcome: "pending" } | { outcome: "validated"; snapshot: TruthSnapshot }> {
  let step = input.initial;
  const seen = new Set<string>();

  while (step.kind === "NEEDS_RESEARCH") {
    const checkpointHash = step.checkpoint.checkpointHash;
    if (seen.has(checkpointHash)) {
      throw new Error("V36 durable continuation repeated the same checkpoint without epistemic progress.");
    }
    seen.add(checkpointHash);

    const loaded = await input.bridge.load(input.runId, checkpointHash);
    if (loaded.outcome === "stale") {
      throw new LostRunOwnershipError(`V36 continuation lost Run epoch ownership at ${input.status}@v${input.version}.`);
    }
    if (loaded.outcome === "missing") {
      const scheduled = await input.bridge.schedule({
        yielded: step,
        expectedStatus: input.status,
        expectedVersion: input.version,
      });
      if (scheduled.outcome === "stale") {
        throw new LostRunOwnershipError(`V36 continuation scheduling lost Run epoch ownership at ${input.status}@v${input.version}.`);
      }
      return { outcome: "pending" };
    }
    if (loaded.outcome === "pending") return { outcome: "pending" };

    step = await input.truthPipeline.resumeDurableValidation(loaded.checkpoint, loaded.results);
  }

  return { outcome: "validated", snapshot: step.execution.snapshot };
}

/**
 * Execute one resumable coordinator tick for an already durable Run.
 *
 * A successful tick performs at most one durable Run version advance. The
 * caller may therefore stop between ticks and later resume from persisted
 * state without relying on in-memory coordinator state. Every accepted write
 * remains guarded by the Run's persisted status/version epoch.
 */
export async function executePersistedRunTick(
  runStore: RunStore,
  truthPipeline: TruthExecutionPipeline,
  runId: string,
  continuationBridge?: DurableV36ContinuationBridge,
): Promise<LatticeRun> {
  let run = await runStore.get(runId);
  if (!run) throw new RunExecutionError("Durable Run could not be loaded for execution.", runId);

  let status: RunStatus = run.status;
  let version = run.version;

  const refresh = async (): Promise<LatticeRun> => {
    const current = await runStore.get(runId);
    if (!current) throw new Error("Run disappeared during durable execution.");
    run = current;
    status = current.status;
    version = current.version;
    return current;
  };

  const advance = async (nextStatus: RunStatus, truthSnapshot?: TruthSnapshot): Promise<LatticeRun> => {
    const result = await runStore.transition({
      runId,
      expectedStatus: status,
      expectedVersion: version,
      nextStatus,
      ...(truthSnapshot ? { truthSnapshot } : {}),
    });
    if (result.outcome !== "advanced") {
      throw new LostRunOwnershipError(`Run transition lost epoch ownership at ${status}@v${version}.`);
    }
    return refresh();
  };

  try {
    if (isSettledStatus(status)) return run;

    if (status === "CREATED") {
      return await advance("UNDERSTANDING");
    }
    if (status === "UNDERSTANDING") {
      return await advance("PLANNING");
    }
    if (status === "PLANNING") {
      return await advance("INVESTIGATING");
    }
    if (status === "INVESTIGATING") {
      const investigation = await truthPipeline.investigate(runId, run.request);
      if (investigation.snapshot.runId !== runId) {
        throw new Error("Truth pipeline returned investigation state for a different Run.");
      }
      return await advance("VALIDATING", investigation.snapshot);
    }
    if (status === "VALIDATING") {
      const persistedInvestigation = await runStore.getTruthSnapshot(runId);
      if (!persistedInvestigation || persistedInvestigation.phase !== "INVESTIGATED") {
        throw new Error("Persisted V36 investigation snapshot could not be reloaded before validation.");
      }

      if (continuationBridge) {
        const durableTruthPipeline = requireDurableTruthPipeline(truthPipeline);
        const initial = await durableTruthPipeline.beginDurableValidation(persistedInvestigation);
        const durable = await advanceDurableValidation({
          bridge: continuationBridge,
          truthPipeline: durableTruthPipeline,
          runId,
          status,
          version,
          initial,
        });
        if (durable.outcome === "pending") return run;
        if (durable.snapshot.runId !== runId) {
          throw new Error("V36 durable continuation returned validated state for a different Run.");
        }
        return await advance(requiresDecision(run.request) ? "DECIDING" : "COMPLETED", durable.snapshot);
      }

      const truth = await truthPipeline.validate(persistedInvestigation);
      if (truth.snapshot.runId !== runId) {
        throw new Error("Truth pipeline returned validated state for a different Run.");
      }
      return await advance(requiresDecision(run.request) ? "DECIDING" : "COMPLETED", truth.snapshot);
    }
    if (status === "DECIDING") {
      const persistedSnapshot = await runStore.getTruthSnapshot(runId);
      if (!persistedSnapshot || persistedSnapshot.phase !== "VALIDATED") {
        throw new Error("Persisted validated V36 truth state could not be reloaded before decision-making.");
      }
      const persistedTruth = persistedSnapshot.bundle;
      const decisionInputs = await truthPipeline.decisionInputs(persistedSnapshot);
      const decisionState = await refresh();
      if (isConsultationRunRequest(decisionState.request)) {
        throw new Error("Qualified consultation decisions require the generalized Decision Engine adapter.");
      }

      if (!decisionState.decision) {
        const decisionEvidence = materializeDecisionEvidence(
          decisionInputs.evidence,
          persistedTruth.claimEvidence,
          persistedTruth.assessments,
        );
        const decision = createDecisionFromAdmittedEvidence(
          decisionState.request,
          decisionInputs.candidates,
          decisionEvidence,
          persistedTruth.assessments.map((assessment) => assessment.id),
        );
        assertDecisionTruthFidelity(decision, persistedTruth);
        const persistedDecision = await runStore.persistDecision({
          runId,
          expectedVersion: version,
          decision,
        });
        if (persistedDecision.outcome !== "advanced") {
          throw new LostRunOwnershipError(`Decision persistence lost epoch ownership at DECIDING@v${version}.`);
        }
        return await refresh();
      }

      const explanationPlan = createSolandraExplanationPlan(
        decisionState.decision,
        decisionInputs.candidates,
        persistedTruth,
      );
      const explanation = renderCanonicalExplanation(explanationPlan);
      assertSolandraExplanationFidelity(
        explanation,
        explanationPlan,
        decisionState.decision,
        decisionInputs.candidates,
        persistedTruth,
      );
      const completed = await runStore.complete({ runId, expectedVersion: version, explanation });
      if (completed.outcome !== "advanced") {
        throw new LostRunOwnershipError(`Run completion lost epoch ownership at DECIDING@v${version}.`);
      }
      return await refresh();
    }

    throw new Error(`Unsupported durable Run execution state: ${status}`);
  } catch (error) {
    if (error instanceof LostRunOwnershipError) {
      throw new RunExecutionError(error.message, runId, true);
    }
    const current = await runStore.get(runId);
    if (current && !isSettledStatus(current.status)) {
      try {
        await runStore.transition({
          runId,
          expectedStatus: current.status,
          expectedVersion: current.version,
          nextStatus: "FAILED",
        });
      } catch {
        // Preserve the original Product failure. A concurrent terminal state or
        // ownership loss remains controlling state and must not be overwritten.
      }
    }
    throw new RunExecutionError(error instanceof Error ? error.message : "Unknown Run error", runId);
  }
}

/**
 * Execute or resume an already durable Run through repeated coordinator ticks.
 * A zero-advance nonterminal tick is an intentional durable wait boundary and
 * returns to the worker so its dispatch can be released for retry.
 */
export async function executePersistedRun(
  runStore: RunStore,
  truthPipeline: TruthExecutionPipeline,
  runId: string,
  continuationBridge?: DurableV36ContinuationBridge,
): Promise<LatticeRun> {
  while (true) {
    const before = await runStore.get(runId);
    if (!before) throw new RunExecutionError("Durable Run could not be loaded for execution.", runId);
    const run = await executePersistedRunTick(runStore, truthPipeline, runId, continuationBridge);
    if (isSettledStatus(run.status)) return run;
    if (run.status === before.status && run.version === before.version) return run;
  }
}
