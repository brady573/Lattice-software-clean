import { createHash } from "node:crypto";
import type { Candidate, Evidence, LatticeRunRequest } from "../domain.js";
import type { CriterionDefinition } from "../decision/criterion-catalog.js";
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
import { prepareV36RuntimeResume, type V36RuntimeExecutionResult } from "./runtime-handoff.js";
import {
  assertTruthSnapshotIntegrity,
  createTruthSnapshot,
  stableStructuredJson,
  type TruthSnapshot,
} from "./snapshot.js";
import type { TruthClaimProfile, TruthEvidenceProfile } from "./types.js";
import type {
  TruthDecisionInputs,
  TruthDurableValidationStep,
  TruthExecutionPipeline,
  TruthPipelineExecution,
  TruthPipelineInvestigation,
} from "./execution-pipeline.js";

export interface PrimaryTruthDataset {
  candidates: Candidate[];
  evidence: Evidence[];
  truthClaims: TruthClaimProfile[];
  truthEvidence: TruthEvidenceProfile[];
}

export interface PrimaryDecisionSemantics {
  catalogVersion: number;
  definitions: CriterionDefinition[];
}

type PrimaryDecisionInputs = TruthDecisionInputs & {
  criterionCatalog?: PrimaryDecisionSemantics;
};

function initialSerialRounds(snapshot: TruthSnapshot): number {
  return Math.max(1, ...snapshot.bundle.researchQuestions.map((question) => question.serialRound));
}

/** Domain-neutral V36 pipeline used by canonical Product runtime and acceptance fixtures. */
export class PrimaryOfflineTruthPipeline implements TruthExecutionPipeline {
  readonly mode = "v36-offline-fixture" as const;
  private readonly dataset: PrimaryTruthDataset;
  private readonly researchProvider: TruthResearchProvider;
  private readonly decisionSemantics: PrimaryDecisionSemantics | undefined;
  private readonly executionContractId: string;

  constructor(
    dataset: PrimaryTruthDataset,
    options: {
      researchProvider?: TruthResearchProvider;
      decisionSemantics?: PrimaryDecisionSemantics;
    } = {},
  ) {
    const researchProvider = options.researchProvider ?? new OfflineFixtureResearchProvider({});
    if (researchProvider.mode !== "offline-fixture") {
      throw new Error("Offline V36 execution cannot activate a live research provider.");
    }
    this.dataset = structuredClone(dataset);
    this.researchProvider = researchProvider;
    this.decisionSemantics = options.decisionSemantics ? structuredClone(options.decisionSemantics) : undefined;
    this.executionContractId = `v36-primary-offline:${createHash("sha256")
      .update(stableStructuredJson({ dataset: this.dataset, decisionSemantics: this.decisionSemantics ?? null }))
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

  private decisionInputsValue(): PrimaryDecisionInputs {
    return {
      candidates: structuredClone(this.dataset.candidates),
      evidence: structuredClone(this.dataset.evidence),
      criterionCatalog: this.decisionSemantics ? structuredClone(this.decisionSemantics) : undefined,
    };
  }

  private durableStep(step: DurableV36ValidationStep): TruthDurableValidationStep {
    if (step.kind === "NEEDS_RESEARCH") return step;
    const snapshot = step.snapshot;
    return {
      kind: "VALIDATED",
      execution: {
        snapshot,
        bundle: snapshot.bundle,
        ...this.decisionInputsValue(),
        serialRounds: step.serialRounds,
      },
    };
  }

  async investigate(runId: string, _request?: LatticeRunRequest): Promise<TruthPipelineInvestigation> {
    if (runId.trim().length === 0) throw new Error("Truth pipeline runId must not be blank.");
    const evaluation = evaluateFixtureTruth(runId, structuredClone(this.dataset));
    const snapshot = createTruthSnapshot("INVESTIGATED", this.executionContractId, evaluation.bundle);
    return { snapshot, serialRounds: evaluation.serialRounds };
  }

  async validate(snapshot: TruthSnapshot): Promise<TruthPipelineExecution> {
    assertTruthSnapshotIntegrity(snapshot);
    if (snapshot.phase !== "INVESTIGATED") throw new Error("V36 validation requires an INVESTIGATED truth snapshot.");
    if (!this.ownsExecutionContract(snapshot.executionContractId)) throw new Error("Truth snapshot was produced by a different V36 execution contract.");
    const enriched = await enrichTruthBundleWithResearch(
      structuredClone(this.dataset),
      snapshot.bundle,
      this.researchProvider,
    );
    const validated = createTruthSnapshot("VALIDATED", this.executionContractId, enriched.bundle);
    return {
      snapshot: validated,
      bundle: validated.bundle,
      ...this.decisionInputsValue(),
      serialRounds: Math.max(initialSerialRounds(snapshot), enriched.serialCriticalPathRounds),
    };
  }

  async beginDurableValidation(snapshot: TruthSnapshot): Promise<TruthDurableValidationStep> {
    assertTruthSnapshotIntegrity(snapshot);
    if (!this.ownsExecutionContract(snapshot.executionContractId)) throw new Error("Truth snapshot was produced by a different V36 execution contract.");
    return this.durableStep(beginDurableV36Validation(snapshot));
  }

  async resumeDurableValidation(
    checkpoint: V36ResearchCheckpoint,
    results: readonly V36RuntimeExecutionResult[],
  ): Promise<TruthDurableValidationStep> {
    if (!this.ownsExecutionContract(checkpoint.executionContractId)) throw new Error("V36 checkpoint was produced by a different execution contract.");
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
    if (snapshot.phase !== "VALIDATED") throw new Error("Decision inputs require a VALIDATED V36 truth snapshot.");
    if (!this.ownsExecutionContract(snapshot.executionContractId)) throw new Error("Truth snapshot was produced by a different V36 execution contract.");
    return this.decisionInputsValue();
  }

  async execute(runId: string, request?: LatticeRunRequest): Promise<TruthPipelineExecution> {
    return this.validate((await this.investigate(runId, request)).snapshot);
  }
}

const emptyPrimaryDataset: PrimaryTruthDataset = Object.freeze({
  candidates: [],
  evidence: [],
  truthClaims: [],
  truthEvidence: [],
});

export function createPrimaryOfflineTruthPipeline(): TruthExecutionPipeline {
  return new PrimaryOfflineTruthPipeline(emptyPrimaryDataset);
}
