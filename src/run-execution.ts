import { randomUUID } from "node:crypto";
import {
  isConsultationRunRequest,
  type GeneralizedDecisionState,
  type LatticeRun,
  type LatticeRunRequest,
  type RunStatus,
} from "./domain.js";
import { decideQualifiedConsultation } from "./decision/generalized-consultation-adapter.js";
import { createDecisionFromAdmittedEvidence } from "./engine.js";
import {
  assertSolandraExplanationFidelity,
  createSolandraExplanationPlan,
  renderCanonicalExplanation,
} from "./presentation/solandra/index.js";
import type { RunStore } from "./run-store.js";
import { materializeDecisionEvidence } from "./truth/admission.js";
import type { TruthDurableValidationStep, TruthExecutionPipeline } from "./truth/execution-pipeline.js";
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

function generalizedExplanation(decision: GeneralizedDecisionState): string {
  const labels = new Map(decision.alternatives.map((item) => [item.alternativeId, item.label]));
  if (decision.resolution === "RECOMMENDATION" && decision.recommendedAlternativeId) {
    return `The admitted evidence licenses ${labels.get(decision.recommendedAlternativeId) ?? decision.recommendedAlternativeId} as the current recommendation. No unadmitted evidence was used.`;
  }
  if (decision.resolution === "TIE") {
    return `The admitted evidence does not establish a material difference among the current frontier alternatives: ${decision.frontierAlternativeIds.map((id) => labels.get(id) ?? id).join(", ")}.`;
  }
  if (decision.resolution === "FRONTIER") {
    return `The current nondominated frontier is ${decision.frontierAlternativeIds.map((id) => labels.get(id) ?? id).join(", ")}; the evidence does not license forcing a single winner.`;
  }
  if (decision.resolution === "UNRESOLVED_CRITERION_SEMANTICS") {
    return `Decision support remains unresolved because qualified criterion semantics are missing for: ${decision.unresolvedCriteria.join(", ")}.`;
  }
  if (decision.resolution === "NO_ELIGIBLE_RESULT") {
    return "No current alternative satisfies the authoritative hard requirements; no winner is manufactured.";
  }
  return `Decision support remains evidence-limited${decision.unresolvedCriteria.length > 0 ? ` for: ${decision.unresolvedCriteria.join(", ")}` : ""}; no winner is manufactured.`;
}

export type DurableV36ContinuationBridge = Pick<PostgresV36ResearchBridge, "load" | "schedule">;
type DurableTruthExecutionPipeline = TruthExecutionPipeline & Required<Pick<TruthExecutionPipeline, "beginDurableValidation" | "resumeDurableValidation">>;

function requireDurableTruthPipeline(pipeline: TruthExecutionPipeline): DurableTruthExecutionPipeline {
  if (!pipeline.beginDurableValidation || !pipeline.resumeDurableValidation) {
    throw new Error("Durable V36 continuation requires explicit begin/resume truth-pipeline capabilities.");
  }
  return pipeline as DurableTruthExecutionPipeline;
}

export function createPendingRun(conversationId: string, request: LatticeRunRequest, runId = randomUUID()): LatticeRun {
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
  constructor(message: string, readonly runId: string, readonly retryable = false) {
    super(message);
  }
}

async function advanceDurableValidation(input: {
  bridge: DurableV36ContinuationBridge;
  truthPipeline: DurableTruthExecutionPipeline;
  runId: string;
  status: RunStatus;
  version: number;
  initial: TruthDurableValidationStep;
}): Promise<{ outcome: "pending" } | { outcome: "validated"; snapshot: TruthSnapshot }> {
  let step = input.initial;
  const seen = new Set<string>();
  while (step.kind === "NEEDS_RESEARCH") {
    const checkpointHash = step.checkpoint.checkpointHash;
    if (seen.has(checkpointHash)) throw new Error("V36 durable continuation repeated the same checkpoint without epistemic progress.");
    seen.add(checkpointHash);
    const loaded = await input.bridge.load(input.runId, checkpointHash);
    if (loaded.outcome === "stale") throw new LostRunOwnershipError(`V36 continuation lost Run epoch ownership at ${input.status}@v${input.version}.`);
    if (loaded.outcome === "missing") {
      const scheduled = await input.bridge.schedule({ yielded: step, expectedStatus: input.status, expectedVersion: input.version });
      if (scheduled.outcome === "stale") throw new LostRunOwnershipError(`V36 continuation scheduling lost Run epoch ownership at ${input.status}@v${input.version}.`);
      return { outcome: "pending" };
    }
    if (loaded.outcome === "pending") return { outcome: "pending" };
    step = await input.truthPipeline.resumeDurableValidation(loaded.checkpoint, loaded.results);
  }
  return { outcome: "validated", snapshot: step.execution.snapshot };
}

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
    if (result.outcome !== "advanced") throw new LostRunOwnershipError(`Run transition lost epoch ownership at ${status}@v${version}.`);
    return refresh();
  };

  try {
    if (isSettledStatus(status)) return run;
    if (status === "CREATED") return await advance("UNDERSTANDING");
    if (status === "UNDERSTANDING") return await advance("PLANNING");
    if (status === "PLANNING") return await advance("INVESTIGATING");
    if (status === "INVESTIGATING") {
      const investigation = await truthPipeline.investigate(runId, run.request);
      if (investigation.snapshot.runId !== runId) throw new Error("Truth pipeline returned investigation state for a different Run.");
      return await advance("VALIDATING", investigation.snapshot);
    }
    if (status === "VALIDATING") {
      const persistedInvestigation = await runStore.getTruthSnapshot(runId);
      if (!persistedInvestigation || persistedInvestigation.phase !== "INVESTIGATED") throw new Error("Persisted V36 investigation snapshot could not be reloaded before validation.");
      if (continuationBridge) {
        const durableTruthPipeline = requireDurableTruthPipeline(truthPipeline);
        const initial = await durableTruthPipeline.beginDurableValidation(persistedInvestigation);
        const durable = await advanceDurableValidation({ bridge: continuationBridge, truthPipeline: durableTruthPipeline, runId, status, version, initial });
        if (durable.outcome === "pending") return run;
        if (durable.snapshot.runId !== runId) throw new Error("V36 durable continuation returned validated state for a different Run.");
        return await advance(requiresDecision(run.request) ? "DECIDING" : "COMPLETED", durable.snapshot);
      }
      const truth = await truthPipeline.validate(persistedInvestigation);
      if (truth.snapshot.runId !== runId) throw new Error("Truth pipeline returned validated state for a different Run.");
      return await advance(requiresDecision(run.request) ? "DECIDING" : "COMPLETED", truth.snapshot);
    }
    if (status === "DECIDING") {
      const persistedSnapshot = await runStore.getTruthSnapshot(runId);
      if (!persistedSnapshot || persistedSnapshot.phase !== "VALIDATED") throw new Error("Persisted validated V36 truth state could not be reloaded before decision-making.");
      const persistedTruth = persistedSnapshot.bundle;
      const decisionState = await refresh();

      if (isConsultationRunRequest(decisionState.request)) {
        if (!decisionState.decision) {
          const decision = await decideQualifiedConsultation(decisionState.request, persistedSnapshot, persistedTruth, truthPipeline);
          const persistedDecision = await runStore.persistDecision({ runId, expectedVersion: version, decision });
          if (persistedDecision.outcome !== "advanced") throw new LostRunOwnershipError(`Decision persistence lost epoch ownership at DECIDING@v${version}.`);
          return await refresh();
        }
        if (!("kind" in decisionState.decision) || decisionState.decision.kind !== "GENERALIZED_DECISION") {
          throw new Error("Qualified consultation persisted a non-generalized decision state.");
        }
        const completed = await runStore.complete({
          runId,
          expectedVersion: version,
          explanation: generalizedExplanation(decisionState.decision),
        });
        if (completed.outcome !== "advanced") throw new LostRunOwnershipError(`Run completion lost epoch ownership at DECIDING@v${version}.`);
        return await refresh();
      }

      const decisionInputs = await truthPipeline.decisionInputs(persistedSnapshot);
      if (!decisionState.decision) {
        const decisionEvidence = materializeDecisionEvidence(decisionInputs.evidence, persistedTruth.claimEvidence, persistedTruth.assessments);
        const decision = createDecisionFromAdmittedEvidence(
          decisionState.request,
          decisionInputs.candidates,
          decisionEvidence,
          persistedTruth.assessments.map((assessment) => assessment.id),
        );
        assertDecisionTruthFidelity(decision, persistedTruth);
        const persistedDecision = await runStore.persistDecision({ runId, expectedVersion: version, decision });
        if (persistedDecision.outcome !== "advanced") throw new LostRunOwnershipError(`Decision persistence lost epoch ownership at DECIDING@v${version}.`);
        return await refresh();
      }
      if ("kind" in decisionState.decision) throw new Error("Legacy bounded Run persisted generalized decision state.");
      const explanationPlan = createSolandraExplanationPlan(decisionState.decision, decisionInputs.candidates, persistedTruth);
      const explanation = renderCanonicalExplanation(explanationPlan);
      assertSolandraExplanationFidelity(explanation, explanationPlan, decisionState.decision, decisionInputs.candidates, persistedTruth);
      const completed = await runStore.complete({ runId, expectedVersion: version, explanation });
      if (completed.outcome !== "advanced") throw new LostRunOwnershipError(`Run completion lost epoch ownership at DECIDING@v${version}.`);
      return await refresh();
    }
    throw new Error(`Unsupported durable Run execution state: ${status}`);
  } catch (error) {
    if (error instanceof LostRunOwnershipError) throw new RunExecutionError(error.message, runId, true);
    const current = await runStore.get(runId);
    if (current && !isSettledStatus(current.status)) {
      try {
        await runStore.transition({ runId, expectedStatus: current.status, expectedVersion: current.version, nextStatus: "FAILED" });
      } catch {
        // Preserve the original Product failure if concurrent state already controls.
      }
    }
    throw new RunExecutionError(error instanceof Error ? error.message : "Unknown Run error", runId);
  }
}

export async function executePersistedRun(
  runStore: RunStore,
  truthPipeline: TruthExecutionPipeline,
  runId: string,
  continuationBridge?: DurableV36ContinuationBridge,
): Promise<LatticeRun> {
  while (true) {
    const before = await runStore.get(runId);
    if (!before) throw new RunExecutionError("Durable Run could not be loaded for execution.", runId);
    const current = await executePersistedRunTick(runStore, truthPipeline, runId, continuationBridge);
    if (isSettledStatus(current.status)) return current;
    if (current.status === before.status && current.version === before.version) return current;
  }
}
