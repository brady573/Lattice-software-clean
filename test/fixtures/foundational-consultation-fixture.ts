import { QualifiedCriterionCatalog } from "../../src/decision/criterion-catalog.js";
import type { LatticeRunRequest } from "../../src/domain.js";
import {
  ConservativeConsultationInterpreter,
  type ConsultationInterpretationInput,
  type ConsultationInterpretationProposal,
  type ConsultationInterpreter,
} from "../../src/intent/consultation-interpreter.js";
import { requiredProofObligations } from "../../src/truth/contracts.js";
import {
  OfflineFixtureTruthPipeline,
  type TruthDurableValidationStep,
  type TruthExecutionPipeline,
  type TruthPipelineExecution,
  type TruthPipelineInvestigation,
} from "../../src/truth/execution-pipeline.js";
import {
  createFixtureDecisionEvidenceProvider,
  type DecisionEvidenceProvider,
} from "../../src/truth/decision-evidence-provider.js";
import type { DecisionFixtureDataset, FixtureDataset } from "../../src/truth/fixture-dataset.js";
import type { V36ResearchCheckpoint } from "../../src/truth/continuation.js";
import type { V36RuntimeExecutionResult } from "../../src/truth/runtime-handoff.js";
import type { TruthSnapshot } from "../../src/truth/snapshot.js";
import type { ProofCheckStatus, TruthClaimProfile } from "../../src/truth/types.js";

export const KNOWLEDGE_MESSAGE = "Explain one reliable property of a lunar eclipse.";
export const DECISION_MESSAGE = "Help me choose a resilient local archive appliance for a small studio.";
export const ACTION_MESSAGE = "Prepare a checklist for preserving a sourdough starter during a short trip.";

function passedChecks(claimType: TruthClaimProfile["claimType"]): Readonly<Record<string, ProofCheckStatus>> {
  return Object.fromEntries(requiredProofObligations(claimType).map((kind) => [kind, "PASSED"]));
}

function knowledgeDataset(claim: string, suffix: string): FixtureDataset {
  const evidenceId = `e-${suffix}`;
  const claimId = `claim-${suffix}`;
  const sourceId = `source-${suffix}`;
  return {
    evidence: [{
      id: evidenceId,
      value: claim,
      sourceId,
      sourceLabel: `Reference fixture ${suffix}`,
      admitted: true,
    }],
    truthClaims: [{
      id: claimId,
      text: claim,
      claimType: "FACTUAL",
      evidenceIds: [evidenceId],
      scope: "consultation",
      checks: passedChecks("FACTUAL"),
      materiallyMisleading: false,
    }],
    truthEvidence: [{
      evidenceId,
      claimId,
      provenanceComponentKey: sourceId,
      provenanceConfidence: "HIGH",
      relation: "SUPPORTS",
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED",
    }],
  };
}

function decisionDataset(): DecisionFixtureDataset {
  const candidates = [
    { id: "cedar", label: "Cedar" },
    { id: "granite", label: "Granite" },
    { id: "willow", label: "Willow" },
  ];
  const values = [
    ["cedar", "cost", 90], ["cedar", "reliability", 9], ["cedar", "throughput", 70],
    ["granite", "cost", 110], ["granite", "reliability", 10], ["granite", "throughput", 95],
    ["willow", "cost", 95], ["willow", "reliability", 7], ["willow", "throughput", 85],
  ] as const;
  return {
    candidates,
    evidence: values.map(([candidateId, criterion, value]) => ({
      id: `e-${candidateId}-${criterion}`,
      candidateId,
      criterion,
      value,
      sourceId: "source-archive-fixture",
      sourceLabel: "Archive appliance fixture",
      admitted: true,
    })),
    truthClaims: values.map(([candidateId, criterion]) => ({
      id: `claim-${candidateId}-${criterion}`,
      text: `${candidateId}.${criterion} is the recorded test value`,
      claimType: "QUANTITATIVE" as const,
      candidateId,
      criterion,
      evidenceIds: [`e-${candidateId}-${criterion}`],
      scope: candidateId,
      unit: criterion,
      denominator: "candidate",
      baseline: "fixture",
      period: "test-static",
      evidenceRisk: "ORDINARY" as const,
      checks: passedChecks("QUANTITATIVE"),
      materiallyMisleading: false,
    })),
    truthEvidence: values.map(([candidateId, criterion]) => ({
      evidenceId: `e-${candidateId}-${criterion}`,
      claimId: `claim-${candidateId}-${criterion}`,
      provenanceComponentKey: "source-archive-fixture",
      provenanceConfidence: "HIGH" as const,
      relation: "SUPPORTS" as const,
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED" as const,
    })),
  };
}

export const foundationalCriterionCatalog = new QualifiedCriterionCatalog(1, [
  {
    criterionId: "cost",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "LOWER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
  {
    criterionId: "reliability",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
  {
    criterionId: "throughput",
    version: 1,
    valueType: "NUMBER",
    preferenceDirection: "HIGHER_IS_BETTER",
    meaningfulDifference: { kind: "ABSOLUTE", minimum: 1 },
  },
]);

export class FoundationalConsultationInterpreter implements ConsultationInterpreter {
  readonly #fallback = new ConservativeConsultationInterpreter();

  async interpret(input: ConsultationInterpretationInput): Promise<ConsultationInterpretationProposal> {
    if (input.message.trim() !== DECISION_MESSAGE) return this.#fallback.interpret(input);
    return {
      objectiveEffect: input.currentIntentVersion
        ? { kind: "PRESERVE" }
        : { kind: "ESTABLISH", value: input.message.trim() },
      meaningKind: "MATERIAL_INFERENCE",
      decisionRequested: true,
      resourceNeed: "NONE",
      materialClarification: {
        operations: [
          { op: "SET", path: { kind: "REQUIREMENT", key: "cost::max" }, value: { state: "VALUE", value: 100 } },
          { op: "SET", path: { kind: "REQUIREMENT", key: "reliability::min" }, value: { state: "VALUE", value: 8 } },
          { op: "SET", path: { kind: "PREFERENCE", key: "throughput" }, value: { state: "VALUE", value: "MATTERS_MOST" } },
        ],
        question: "I interpreted cost at most 100 and reliability at least 8 as hard requirements, with throughput as the top priority. Is that correct?",
        confirmationExample: "Yes, that's correct.",
      },
    };
  }
}

/** Test-only request router proving multiple Product outcomes on one API. */
export class FoundationalTruthPipeline implements TruthExecutionPipeline {
  readonly mode = "v36-offline-fixture" as const;
  readonly #knowledge = new OfflineFixtureTruthPipeline(knowledgeDataset(
    "A lunar eclipse occurs when Earth passes between the Sun and the Moon and Earth's shadow falls on the Moon.",
    "eclipse",
  ));
  readonly #decision = new OfflineFixtureTruthPipeline(decisionDataset());
  readonly #action = new OfflineFixtureTruthPipeline(knowledgeDataset(
    "A refrigerated sourdough starter can be maintained without daily room-temperature feeding during a short trip.",
    "starter",
  ));

  #forRequest(request: LatticeRunRequest | undefined): OfflineFixtureTruthPipeline {
    if (request && "kind" in request && request.objective === DECISION_MESSAGE) return this.#decision;
    if (request && "kind" in request && request.objective === ACTION_MESSAGE) return this.#action;
    return this.#knowledge;
  }

  #forContract(executionContractId: string): OfflineFixtureTruthPipeline {
    for (const pipeline of [this.#knowledge, this.#decision, this.#action]) {
      if (pipeline.ownsExecutionContract(executionContractId)) return pipeline;
    }
    throw new Error("Unknown foundational test execution contract.");
  }

  investigate(runId: string, request?: LatticeRunRequest): Promise<TruthPipelineInvestigation> {
    return this.#forRequest(request).investigate(runId);
  }

  validate(snapshot: TruthSnapshot): Promise<TruthPipelineExecution> {
    return this.#forContract(snapshot.executionContractId).validate(snapshot);
  }

  beginDurableValidation(snapshot: TruthSnapshot): Promise<TruthDurableValidationStep> {
    return this.#forContract(snapshot.executionContractId).beginDurableValidation(snapshot);
  }

  resumeDurableValidation(
    checkpoint: V36ResearchCheckpoint,
    results: readonly V36RuntimeExecutionResult[],
  ): Promise<TruthDurableValidationStep> {
    return this.#forContract(checkpoint.executionContractId).resumeDurableValidation(checkpoint, results);
  }

  createDecisionEvidenceProvider(): DecisionEvidenceProvider {
    return createFixtureDecisionEvidenceProvider(
      decisionDataset(),
      (executionContractId) => this.#decision.ownsExecutionContract(executionContractId),
    );
  }

  async execute(runId: string, request?: LatticeRunRequest): Promise<TruthPipelineExecution> {
    const investigation = await this.investigate(runId, request);
    return this.validate(investigation.snapshot);
  }
}

export function createFoundationalTruthComposition(): {
  truthPipeline: FoundationalTruthPipeline;
  decisionEvidenceProvider: DecisionEvidenceProvider;
} {
  const truthPipeline = new FoundationalTruthPipeline();
  return {
    truthPipeline,
    decisionEvidenceProvider: truthPipeline.createDecisionEvidenceProvider(),
  };
}
