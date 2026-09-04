import { createHash } from "node:crypto";
import type { LatticeRunRequest } from "../domain.js";
import type { FixtureDataset } from "./fixture-dataset.js";
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

export interface TruthPipelineExecution {
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
  readonly mode: "v36-offline-fixture" | "v36-live-knowledge";
  investigate(runId: string, request?: LatticeRunRequest): Promise<TruthPipelineInvestigation>;
  validate(snapshot: TruthSnapshot): Promise<TruthPipelineExecution>;
  beginDurableValidation?(snapshot: TruthSnapshot): Promise<TruthDurableValidationStep>;
  resumeDurableValidation?(
    checkpoint: V36ResearchCheckpoint,
    results: readonly V36RuntimeExecutionResult[],
  ): Promise<TruthDurableValidationStep>;
  execute(runId: string, request?: LatticeRunRequest): Promise<TruthPipelineExecution>;
}

function initialSerialRounds(snapshot: TruthSnapshot): number {
  return Math.max(1, ...snapshot.bundle.researchQuestions.map((question) => question.serialRound));
}

/**
 * Deterministic offline V36 seam. Truth execution produces validated truth
 * state only; the optional decision-specific projection is a separate adapter.
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

  ownsExecutionContract(executionContractId: string): boolean {
    return executionContractId === this.executionContractId;
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
    if (!this.ownsExecutionContract(snapshot.executionContractId)) {
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
      serialRounds: Math.max(initialSerialRounds(snapshot), enriched.serialCriticalPathRounds),
    };
  }

  async beginDurableValidation(snapshot: TruthSnapshot): Promise<TruthDurableValidationStep> {
    assertTruthSnapshotIntegrity(snapshot);
    if (!this.ownsExecutionContract(snapshot.executionContractId)) {
      throw new Error("Truth snapshot was produced by a different V36 execution contract.");
    }
    return this.durableStep(beginDurableV36Validation(snapshot));
  }

  async resumeDurableValidation(
    checkpoint: V36ResearchCheckpoint,
    results: readonly V36RuntimeExecutionResult[],
  ): Promise<TruthDurableValidationStep> {
    if (!this.ownsExecutionContract(checkpoint.executionContractId)) {
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

  async execute(runId: string): Promise<TruthPipelineExecution> {
    const investigation = await this.investigate(runId);
    return this.validate(investigation.snapshot);
  }
}

const emptyKnowledgeFixture: FixtureDataset = Object.freeze({
  truthClaims: [],
  truthEvidence: [],
});

export function createDefaultOfflineTruthPipeline(): TruthExecutionPipeline {
  return new OfflineFixtureTruthPipeline(emptyKnowledgeFixture);
}
