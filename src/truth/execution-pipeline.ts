import { createHash } from "node:crypto";
import type { Candidate, Evidence } from "../domain.js";
import { defaultDecisionFixture, type FixtureDataset } from "../fixtures.js";
import type { V36ResearchCheckpoint } from "./continuation.js";
import {
  beginDurableV36Validation,
  resumeDurableV36Validation,
  type DurableV36ValidationStep,
} from "./durable-validation.js";
import { evaluateFixtureTruth } from "./fixture-evaluation.js";
import {
  FailClosedResearchEvidenceAdmissionPolicy,
  OfflineFixtureResearchProvider,
  type ResearchEvidenceAdmissionPolicy,
  type TruthResearchProvider,
} from "./pipeline.js";
import { enrichTruthBundleWithResearch } from "./research-enrichment.js";
import {
  prepareV36RuntimeResume,
  type V36RuntimeExecutionResult,
} from "./runtime-handoff.js";
import {
  assertTruthSnapshotIntegrity,
  createTruthSnapshot,
  stableStructuredJson,
  type TruthSnapshot,
} from "./snapshot.js";
import type { TruthBundle } from "./types.js";

export interface TruthPipelineInvestigation {
  snapshot: TruthSnapshot;
  serialRounds: number;
}

export interface TruthDecisionInputs {
  candidates: Candidate[];
  evidence: Evidence[];
}

export interface TruthPipelineExecution extends TruthDecisionInputs {
  snapshot: TruthSnapshot;
  bundle: TruthBundle;
  serialRounds: number;
}

export type TruthDurableValidationStep =
  | Extract<DurableV36ValidationStep, { kind: "NEEDS_RESEARCH" }>
  | {
      kind: "VALIDATED";
      execution: TruthPipelineExecution;
    };

export interface TruthExecutionPipeline {
  readonly mode: "v36-offline-fixture";
  investigate(runId: string): Promise<TruthPipelineInvestigation>;
  validate(snapshot: TruthSnapshot): Promise<TruthPipelineExecution>;
  beginDurableValidation?(snapshot: TruthSnapshot): Promise<TruthDurableValidationStep>;
  resumeDurableValidation?(
    checkpoint: V36ResearchCheckpoint,
    results: readonly V36RuntimeExecutionResult[],
  ): Promise<TruthDurableValidationStep>;
  decisionInputs(snapshot: TruthSnapshot): Promise<TruthDecisionInputs>;
  execute(runId: string): Promise<TruthPipelineExecution>;
}

function initialSerialRounds(snapshot: TruthSnapshot): number {
  return Math.max(1, ...snapshot.bundle.researchQuestions.map((question) => question.serialRound));
}

/**
 * Deterministic offline execution seam for the current V36 prototype.
 *
 * V36 itself produces stage-tagged snapshots. Validation consumes the exact
 * investigation snapshot directly; it never re-runs fixture compilation or
 * adjudication to authenticate persisted state.
 */
export class OfflineFixtureTruthPipeline implements TruthExecutionPipeline {
  readonly mode = "v36-offline-fixture" as const;
  private readonly dataset: FixtureDataset;
  private readonly researchProvider: TruthResearchProvider;
  private readonly executionContractId: string;

  constructor(
    dataset: FixtureDataset,
    researchProvider: TruthResearchProvider = new OfflineFixtureResearchProvider({}),
  ) {
    if (researchProvider.mode !== "offline-fixture") {
      throw new Error("Offline V36 execution cannot activate a live research provider.");
    }
    this.dataset = structuredClone(dataset);
    this.researchProvider = researchProvider;
    this.executionContractId = `v36-offline-fixture:${createHash("sha256")
      .update(stableStructuredJson(this.dataset))
      .digest("hex")}`;
  }

  private durableAdmissionPolicy(): ResearchEvidenceAdmissionPolicy {
    return this.researchProvider instanceof OfflineFixtureResearchProvider
      ? this.researchProvider.getFixtureAdmissionPolicy()
      : new FailClosedResearchEvidenceAdmissionPolicy();
  }

  private durableStep(step: DurableV36ValidationStep): TruthDurableValidationStep {
    if (step.kind === "NEEDS_RESEARCH") return step;
    const snapshot = step.snapshot;
    return {
      kind: "VALIDATED",
      execution: {
        snapshot,
        bundle: snapshot.bundle,
        candidates: structuredClone(this.dataset.candidates),
        evidence: structuredClone(this.dataset.evidence),
        serialRounds: step.serialRounds,
      },
    };
  }

  async investigate(runId: string): Promise<TruthPipelineInvestigation> {
    if (runId.trim().length === 0) throw new Error("Truth pipeline runId must not be blank.");
    const dataset = structuredClone(this.dataset);
    const evaluation = evaluateFixtureTruth(runId, dataset);
    const snapshot = createTruthSnapshot("INVESTIGATED", this.executionContractId, evaluation.bundle);
    return { snapshot, serialRounds: evaluation.serialRounds };
  }

  async validate(snapshot: TruthSnapshot): Promise<TruthPipelineExecution> {
    assertTruthSnapshotIntegrity(snapshot);
    if (snapshot.phase !== "INVESTIGATED") {
      throw new Error("V36 validation requires an INVESTIGATED truth snapshot.");
    }
    if (snapshot.executionContractId !== this.executionContractId) {
      throw new Error("Truth snapshot was produced by a different V36 execution contract.");
    }

    const dataset = structuredClone(this.dataset);
    const enriched = await enrichTruthBundleWithResearch(
      dataset,
      snapshot.bundle,
      this.researchProvider,
    );
    const validated = createTruthSnapshot("VALIDATED", this.executionContractId, enriched.bundle);
    return {
      snapshot: validated,
      bundle: validated.bundle,
      candidates: dataset.candidates,
      evidence: dataset.evidence,
      serialRounds: Math.max(initialSerialRounds(snapshot), enriched.serialCriticalPathRounds),
    };
  }

  async beginDurableValidation(snapshot: TruthSnapshot): Promise<TruthDurableValidationStep> {
    assertTruthSnapshotIntegrity(snapshot);
    if (snapshot.executionContractId !== this.executionContractId) {
      throw new Error("Truth snapshot was produced by a different V36 execution contract.");
    }
    return this.durableStep(beginDurableV36Validation(snapshot));
  }

  async resumeDurableValidation(
    checkpoint: V36ResearchCheckpoint,
    results: readonly V36RuntimeExecutionResult[],
  ): Promise<TruthDurableValidationStep> {
    if (checkpoint.executionContractId !== this.executionContractId) {
      throw new Error("V36 checkpoint was produced by a different execution contract.");
    }
    const prepared = prepareV36RuntimeResume(checkpoint, results);
    return this.durableStep(resumeDurableV36Validation(
      structuredClone(this.dataset),
      prepared.checkpoint,
      prepared.results,
      this.durableAdmissionPolicy(),
    ));
  }

  async decisionInputs(snapshot: TruthSnapshot): Promise<TruthDecisionInputs> {
    assertTruthSnapshotIntegrity(snapshot);
    if (snapshot.phase !== "VALIDATED") {
      throw new Error("Decision inputs require a VALIDATED V36 truth snapshot.");
    }
    if (snapshot.executionContractId !== this.executionContractId) {
      throw new Error("Truth snapshot was produced by a different V36 execution contract.");
    }
    return {
      candidates: structuredClone(this.dataset.candidates),
      evidence: structuredClone(this.dataset.evidence),
    };
  }

  async execute(runId: string): Promise<TruthPipelineExecution> {
    const investigation = await this.investigate(runId);
    return this.validate(investigation.snapshot);
  }
}

export function createDefaultOfflineTruthPipeline(): TruthExecutionPipeline {
  return new OfflineFixtureTruthPipeline(defaultDecisionFixture);
}
