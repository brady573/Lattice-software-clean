import type {
  ConsultationRunRequest,
  GeneralizedDecisionState,
} from "../domain.js";
import type { TruthExecutionPipeline, TruthDecisionInputs } from "../truth/execution-pipeline.js";
import { materializeDecisionEvidence, type AdmittedDecisionEvidence } from "../truth/admission.js";
import type { TruthSnapshot } from "../truth/snapshot.js";
import type { TruthBundle } from "../truth/types.js";
import { QualifiedCriterionCatalog, type CriterionDefinition } from "./criterion-catalog.js";
import { buildDecisionInputSnapshot, type DecisionInputSnapshot } from "./decision-input-snapshot.js";
import { constructMaterialDominanceFrontier } from "./material-dominance-frontier.js";
import { evaluateMeaningfulDifference } from "./meaningful-difference.js";
import { evaluateHardRequirement, type HardRequirementState } from "./priority-and-requirements.js";

interface DecisionInputsWithCatalog extends TruthDecisionInputs {
  criterionCatalog?: {
    catalogVersion: number;
    definitions: CriterionDefinition[];
  };
}

type Alternative = {
  alternativeId: string;
  label: string;
  eligibility: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
};

function fieldValue(field: ConsultationRunRequest["intentState"]["objective"]): string | number | boolean | null {
  return field?.value.state === "VALUE" ? field.value.value : null;
}

function suffixAfter(key: string, prefix: string): string {
  return key.slice(prefix.length);
}

function alternativeLabels(request: ConsultationRunRequest): string[] {
  return Object.entries(request.intentState.requirements)
    .filter(([key]) => key.startsWith("decision.alternative."))
    .flatMap(([, field]) => {
      const value = fieldValue(field);
      return typeof value === "string" ? [value] : [];
    });
}

function authoritativeDecisionSemantics(request: ConsultationRunRequest) {
  const hardRequirements = Object.entries(request.intentState.requirements).flatMap(([key, field]) => {
    if (!key.startsWith("decision.hard.")) return [];
    const body = suffixAfter(key, "decision.hard.");
    const split = body.lastIndexOf(".");
    if (split < 1) return [];
    const criterionId = body.slice(0, split);
    const operator = body.slice(split + 1);
    const expected = fieldValue(field);
    if (!["LTE", "GTE", "EQ"].includes(operator) || expected === null) return [];
    return [{ criterionId, operator: operator as "LTE" | "GTE" | "EQ", expected }];
  });

  const priorities = Object.entries(request.intentState.preferences).flatMap(([key, field]) => {
    if (!key.startsWith("decision.priority.")) return [];
    const criterionId = suffixAfter(key, "decision.priority.");
    const tier = fieldValue(field);
    if (!["MUST_HAVE", "MATTERS_MOST", "IMPORTANT", "NICE_TO_HAVE"].includes(String(tier))) return [];
    return [{ criterionId, tier: tier as "MUST_HAVE" | "MATTERS_MOST" | "IMPORTANT" | "NICE_TO_HAVE" }];
  });

  return {
    intentScopeId: request.intentScopeId,
    intentVersionId: request.intentVersionId,
    objective: request.objective,
    hardRequirements,
    priorities,
    tolerances: [] as { criterionId: string; kind: "ABSOLUTE"; maximumDifference: number }[],
  };
}

function unresolvedState(
  request: ConsultationRunRequest,
  inputs: DecisionInputsWithCatalog,
  unresolvedCriteria: string[],
): GeneralizedDecisionState {
  return {
    kind: "GENERALIZED_DECISION",
    intentScopeId: request.intentScopeId,
    intentVersionId: request.intentVersionId,
    criterionCatalogVersion: inputs.criterionCatalog?.catalogVersion ?? null,
    objective: request.objective,
    resolution: "UNRESOLVED_CRITERION_SEMANTICS",
    alternatives: alternativeLabels(request).map((label) => ({ alternativeId: label, label, eligibility: "UNKNOWN" })),
    frontierAlternativeIds: [],
    recommendedAlternativeId: null,
    excludedAlternatives: [],
    pairwiseDecisions: [],
    unresolvedCriteria: [...new Set(unresolvedCriteria)].sort(),
    evidenceIds: [],
    truthAssessmentIds: [],
    forcedWinner: false,
  };
}

function admittedValue(
  admitted: readonly AdmittedDecisionEvidence[],
  candidateId: string,
  criterionId: string,
): string | number | boolean | null {
  const values = admitted
    .filter((item) => item.candidateId === candidateId && item.criterion === criterionId)
    .map((item) => item.value);
  if (values.length === 0) return null;
  const first = values[0]!;
  return values.every((value) => JSON.stringify(value) === JSON.stringify(first)) ? first : null;
}

function mapAlternatives(
  request: ConsultationRunRequest,
  inputs: DecisionInputsWithCatalog,
  snapshot: DecisionInputSnapshot,
  admitted: readonly AdmittedDecisionEvidence[],
): Alternative[] {
  const requested = alternativeLabels(request);
  return requested.map((label) => {
    const candidate = inputs.candidates.find((item) =>
      item.id.localeCompare(label, undefined, { sensitivity: "accent" }) === 0
      || item.label.localeCompare(label, undefined, { sensitivity: "accent" }) === 0
      || item.id.toLowerCase() === label.toLowerCase()
      || item.label.toLowerCase() === label.toLowerCase()
    );
    if (!candidate) return { alternativeId: label, label, eligibility: "UNKNOWN" };

    const requirementStates: HardRequirementState[] = snapshot.hardRequirements.map((requirement) =>
      evaluateHardRequirement(
        requirement,
        admittedValue(admitted, candidate.id, requirement.criterionId),
      )
    );
    const eligibility = requirementStates.includes("FAILED")
      ? "INELIGIBLE"
      : requirementStates.includes("UNKNOWN")
        ? "UNKNOWN"
        : "ELIGIBLE";
    return { alternativeId: candidate.id, label: candidate.label, eligibility };
  });
}

/**
 * Decision-specific projection outside V36. V36 admits factual evidence; Intent
 * Authority owns USER meaning; Criterion Catalog owns criterion semantics; M6
 * computes only the nondominated decision frontier.
 */
export async function decideQualifiedConsultation(
  request: ConsultationRunRequest,
  truthSnapshot: TruthSnapshot,
  truth: TruthBundle,
  truthPipeline: TruthExecutionPipeline,
): Promise<GeneralizedDecisionState> {
  const inputs = await truthPipeline.decisionInputs(truthSnapshot) as DecisionInputsWithCatalog;
  const semantics = authoritativeDecisionSemantics(request);
  const referencedCriteria = [
    ...semantics.hardRequirements.map((item) => item.criterionId),
    ...semantics.priorities.map((item) => item.criterionId),
  ];
  if (!inputs.criterionCatalog) return unresolvedState(request, inputs, referencedCriteria);

  let catalog: QualifiedCriterionCatalog;
  let snapshot: DecisionInputSnapshot;
  try {
    catalog = new QualifiedCriterionCatalog(inputs.criterionCatalog.catalogVersion, inputs.criterionCatalog.definitions);
    snapshot = buildDecisionInputSnapshot(semantics, catalog);
  } catch {
    return unresolvedState(request, inputs, referencedCriteria);
  }

  const admitted = materializeDecisionEvidence(inputs.evidence, truth.claimEvidence, truth.assessments);
  const alternatives = mapAlternatives(request, inputs, snapshot, admitted);
  if (admitted.length === 0) {
    return {
      ...unresolvedState(request, inputs, []),
      criterionCatalogVersion: snapshot.criterionCatalogVersion,
      resolution: "INSUFFICIENT_EVIDENCE",
      alternatives,
      unresolvedCriteria: snapshot.criterionBindings.map((binding) => binding.criterionId),
      truthAssessmentIds: truth.assessments.map((item) => item.id),
    };
  }

  const comparisons = [];
  for (let leftIndex = 0; leftIndex < alternatives.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < alternatives.length; rightIndex += 1) {
      const left = alternatives[leftIndex]!;
      const right = alternatives[rightIndex]!;
      if (left.eligibility !== "ELIGIBLE" || right.eligibility !== "ELIGIBLE") continue;
      comparisons.push({
        leftAlternativeId: left.alternativeId,
        rightAlternativeId: right.alternativeId,
        criteria: snapshot.priorities.map((priority) => {
          const definition = catalog.requireExact(priority.criterionId, priority.criterionVersion);
          const tolerance = snapshot.tolerances.find((item) => item.criterionId === priority.criterionId) ?? null;
          const leftRaw = admittedValue(admitted, left.alternativeId, priority.criterionId);
          const rightRaw = admittedValue(admitted, right.alternativeId, priority.criterionId);
          const evaluation = evaluateMeaningfulDifference(
            definition,
            typeof leftRaw === "number" ? leftRaw : null,
            typeof rightRaw === "number" ? rightRaw : null,
            tolerance,
          );
          return {
            criterionId: priority.criterionId,
            criterionVersion: priority.criterionVersion,
            tier: priority.tier,
            state: evaluation.state,
            preferredSide: evaluation.preferredSide,
          };
        }),
      });
    }
  }

  const frontier = constructMaterialDominanceFrontier({
    alternatives: alternatives.map((item) => ({ alternativeId: item.alternativeId, eligibility: item.eligibility })),
    comparisons,
  });
  const unresolvedCriteria = [...new Set(frontier.pairwiseDecisions.flatMap((item) => item.unresolvedCriteria))].sort();
  const eligibleCount = alternatives.filter((item) => item.eligibility === "ELIGIBLE").length;
  const unknownEligibility = alternatives.some((item) => item.eligibility === "UNKNOWN");
  const allNoDifference = frontier.pairwiseDecisions.length > 0
    && frontier.pairwiseDecisions.every((item) => item.reason === "NO_MATERIAL_DIFFERENCE");

  const resolution: GeneralizedDecisionState["resolution"] = eligibleCount === 0
    ? unknownEligibility ? "INSUFFICIENT_EVIDENCE" : "NO_ELIGIBLE_RESULT"
    : unresolvedCriteria.length > 0
      ? "INSUFFICIENT_EVIDENCE"
      : frontier.frontierAlternativeIds.length === 1
        ? "RECOMMENDATION"
        : allNoDifference ? "TIE" : "FRONTIER";
  const recommendedAlternativeId = resolution === "RECOMMENDATION"
    ? frontier.frontierAlternativeIds[0] ?? null
    : null;

  return {
    kind: "GENERALIZED_DECISION",
    intentScopeId: request.intentScopeId,
    intentVersionId: request.intentVersionId,
    criterionCatalogVersion: snapshot.criterionCatalogVersion,
    objective: request.objective,
    resolution,
    alternatives,
    frontierAlternativeIds: [...frontier.frontierAlternativeIds],
    recommendedAlternativeId,
    excludedAlternatives: [...frontier.excludedAlternatives],
    pairwiseDecisions: frontier.pairwiseDecisions.map((item) => ({ ...item })),
    unresolvedCriteria,
    evidenceIds: admitted.map((item) => item.id),
    truthAssessmentIds: truth.assessments.map((item) => item.id),
    forcedWinner: false,
  };
}
