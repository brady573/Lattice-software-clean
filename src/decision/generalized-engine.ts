import type {
  Candidate,
  CandidateEvaluation,
  DecisionOutcome,
  FrontierDecisionIds,
  StructuredDecision,
  MultipleDecisionIds,
  NonEmptyDecisionIds,
} from "../domain.js";
import {
  assertAdmittedDecisionEvidence,
  type AdmittedDecisionEvidence,
} from "../truth/admission.js";
import type { QualifiedCriterionCatalog } from "./criterion-catalog.js";
import type { DecisionInputSnapshot } from "./decision-input-snapshot.js";
import { evaluateMeaningfulDifference } from "./meaningful-difference.js";
import { constructMaterialDominanceFrontier } from "./material-dominance-frontier.js";
import { evaluateHardRequirement } from "./priority-and-requirements.js";

function evidenceFor(
  evidence: readonly AdmittedDecisionEvidence[],
  candidateId: string,
  criterionId: string,
): AdmittedDecisionEvidence | undefined {
  return evidence.find((item) => item.candidateId === candidateId && item.criterion === criterionId);
}

function nonEmptyDecisionIds(values: string[], label: string): NonEmptyDecisionIds {
  if (values.length === 0) throw new Error(`${label} unexpectedly resolved to an empty decision set.`);
  return [values[0]!, ...values.slice(1)];
}

function multipleDecisionIds(values: string[], label: string): MultipleDecisionIds {
  if (values.length < 2) throw new Error(`${label} unexpectedly resolved to fewer than two candidates.`);
  return [values[0]!, values[1]!, ...values.slice(2)];
}

function frontierDecisionIds(values: string[], label: string): FrontierDecisionIds {
  if (values.length === 0) return [];
  return multipleDecisionIds(values, label);
}

function rationaleFor(outcome: DecisionOutcome): string {
  switch (outcome) {
    case "RECOMMENDATION":
      return "One eligible alternative materially dominates the others under the qualified criterion semantics.";
    case "FRONTIER":
      return "No unique recommendation is supported by the qualified material-dominance result; no scalar score or forced winner was manufactured.";
    case "TIE":
      return "The qualified comparisons found no meaningful difference between the remaining alternatives.";
    case "INSUFFICIENT_EVIDENCE":
      return "V36-admitted evidence is insufficient for at least one execution-significant comparison.";
    case "UNRESOLVED":
      return "Qualified criterion semantics cannot resolve at least one material comparison.";
    case "NO_ELIGIBLE_CANDIDATE":
      return "No alternative is known to satisfy the authoritative requirements.";
  }
}

/**
 * Apply qualified requirement and meaningful-difference semantics without
 * summing raw values from incompatible scales. Numeric utility is deliberately
 * absent unless a future CriterionDefinition explicitly licenses it.
 */
export function createGeneralizedDecisionFromAdmittedEvidence(
  input: DecisionInputSnapshot,
  catalog: QualifiedCriterionCatalog,
  candidates: readonly Candidate[],
  evidence: readonly AdmittedDecisionEvidence[],
  truthAssessmentIds: readonly string[],
): StructuredDecision {
  assertAdmittedDecisionEvidence(evidence);
  const eligibilityByCandidate = new Map<string, "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN">();
  const evaluations: CandidateEvaluation[] = candidates.map((candidate) => {
    const constraints = input.hardRequirements.map((requirement) => {
      const observedEvidence = evidenceFor(evidence, candidate.id, requirement.criterionId);
      const observed = observedEvidence?.value ?? null;
      const state = evaluateHardRequirement({
        criterionId: requirement.criterionId,
        criterionVersion: requirement.criterionVersion,
        operator: requirement.operator,
        expected: requirement.expected,
      }, observed);
      return {
        criterion: requirement.criterionId,
        passed: state === "SATISFIED" ? true : state === "FAILED" ? false : null,
        observed,
        expected: requirement.expected,
      };
    });
    const eligibility = constraints.some((constraint) => constraint.passed === false)
      ? "INELIGIBLE" as const
      : constraints.some((constraint) => constraint.passed === null)
        ? "UNKNOWN" as const
        : "ELIGIBLE" as const;
    eligibilityByCandidate.set(candidate.id, eligibility);
    return {
      candidateId: candidate.id,
      eligible: eligibility === "ELIGIBLE",
      rawScore: 0,
      normalizedScore: 0,
      constraints,
      supportingEvidenceIds: evidence
        .filter((item) => item.candidateId === candidate.id)
        .map((item) => item.id),
    };
  });

  const eligibleIds = candidates
    .filter((candidate) => eligibilityByCandidate.get(candidate.id) === "ELIGIBLE")
    .map((candidate) => candidate.id);
  const unknownEligibility = candidates
    .filter((candidate) => eligibilityByCandidate.get(candidate.id) === "UNKNOWN")
    .map((candidate) => candidate.id);

  const evidenceIdsFor = (candidateIds: readonly string[]): string[] => {
    const relevant = new Set(candidateIds);
    return [...new Set(evidence
      .filter((item) => relevant.has(item.candidateId))
      .map((item) => item.id))];
  };
  const shared = (outcome: DecisionOutcome, candidateIds: readonly string[]) => ({
    goal: input.objective,
    evaluations,
    rationale: [rationaleFor(outcome)],
    evidenceIds: evidenceIdsFor(candidateIds),
    truthAssessmentIds: [...truthAssessmentIds],
  });

  if (unknownEligibility.length > 0) {
    const frontierCandidateIds = [...eligibleIds, ...unknownEligibility];
    const materialUnknowns = evaluations.flatMap((evaluation) => evaluation.constraints
      .filter((constraint) => constraint.passed === null)
      .map((constraint) => `${evaluation.candidateId}:${constraint.criterion}`));
    return {
      ...shared("INSUFFICIENT_EVIDENCE", frontierCandidateIds),
      outcome: "INSUFFICIENT_EVIDENCE",
      frontierCandidateIds: nonEmptyDecisionIds(frontierCandidateIds, "INSUFFICIENT_EVIDENCE frontier"),
      tiedCandidateIds: [],
      materialUnknowns: nonEmptyDecisionIds(materialUnknowns, "INSUFFICIENT_EVIDENCE material unknowns"),
    };
  }

  if (eligibleIds.length === 0) {
    return {
      ...shared("NO_ELIGIBLE_CANDIDATE", []),
      outcome: "NO_ELIGIBLE_CANDIDATE",
      frontierCandidateIds: [],
      tiedCandidateIds: [],
      materialUnknowns: [],
    };
  }

  if (input.priorities.length === 0) {
    if (eligibleIds.length === 1) {
      const winnerCandidateId = eligibleIds[0]!;
      return {
        ...shared("RECOMMENDATION", [winnerCandidateId]),
        outcome: "RECOMMENDATION",
        winnerCandidateId,
        frontierCandidateIds: [winnerCandidateId],
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
    }
    return {
      ...shared("FRONTIER", eligibleIds),
      outcome: "FRONTIER",
      frontierCandidateIds: multipleDecisionIds(eligibleIds, "FRONTIER candidates"),
      tiedCandidateIds: [],
      materialUnknowns: [],
    };
  }

  const comparisons = [];
  const comparisonUnknowns: string[] = [];
  for (let leftIndex = 0; leftIndex < eligibleIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < eligibleIds.length; rightIndex += 1) {
      const leftAlternativeId = eligibleIds[leftIndex]!;
      const rightAlternativeId = eligibleIds[rightIndex]!;
      const criteria = input.priorities.map((priority) => {
        const definition = catalog.requireExact(priority.criterionId, priority.criterionVersion);
        const leftEvidence = evidenceFor(evidence, leftAlternativeId, priority.criterionId);
        const rightEvidence = evidenceFor(evidence, rightAlternativeId, priority.criterionId);
        if (!leftEvidence || !rightEvidence) return undefined;
        const tolerance = input.tolerances.find((candidate) =>
          candidate.criterionId === priority.criterionId
          && candidate.criterionVersion === priority.criterionVersion) ?? null;
        const comparison = evaluateMeaningfulDifference(
          definition,
          typeof leftEvidence.value === "number" ? leftEvidence.value : null,
          typeof rightEvidence.value === "number" ? rightEvidence.value : null,
          tolerance,
        );
        return {
          criterionId: priority.criterionId,
          criterionVersion: priority.criterionVersion,
          tier: priority.tier,
          state: comparison.state,
          preferredSide: comparison.preferredSide,
        };
      });
      if (criteria.some((criterion) => criterion === undefined)) {
        comparisonUnknowns.push(`${leftAlternativeId}:${rightAlternativeId}:missing-admitted-evidence`);
        continue;
      }
      comparisons.push({
        leftAlternativeId,
        rightAlternativeId,
        criteria: criteria.filter((criterion) => criterion !== undefined),
      });
    }
  }

  const frontier = constructMaterialDominanceFrontier({
    alternatives: candidates.map((candidate) => ({
      alternativeId: candidate.id,
      eligibility: eligibilityByCandidate.get(candidate.id) ?? "UNKNOWN",
    })),
    comparisons,
  });
  const frontierCandidateIds = [...frontier.frontierAlternativeIds];
  const materialUnknowns = [...new Set([
    ...comparisonUnknowns,
    ...frontier.pairwiseDecisions.flatMap((decision) => decision.unresolvedCriteria),
  ])];

  switch (frontier.outcome) {
    case "RECOMMENDATION": {
      if (frontierCandidateIds.length !== 1) {
        throw new Error("RECOMMENDATION must resolve exactly one material-dominance frontier candidate.");
      }
      if (materialUnknowns.length !== 0) throw new Error("RECOMMENDATION cannot retain material unknowns.");
      const winnerCandidateId = frontierCandidateIds[0]!;
      return {
        ...shared("RECOMMENDATION", frontierCandidateIds),
        outcome: "RECOMMENDATION",
        winnerCandidateId,
        frontierCandidateIds: [winnerCandidateId],
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
    }
    case "FRONTIER":
      if (materialUnknowns.length !== 0) throw new Error("FRONTIER cannot retain material unknowns.");
      return {
        ...shared("FRONTIER", frontierCandidateIds),
        outcome: "FRONTIER",
        frontierCandidateIds: frontierDecisionIds(frontierCandidateIds, "FRONTIER candidates"),
        tiedCandidateIds: [],
        materialUnknowns: [],
      };
    case "TIE": {
      if (materialUnknowns.length !== 0) throw new Error("TIE cannot retain material unknowns.");
      const tiedCandidateIds = multipleDecisionIds(frontierCandidateIds, "TIE frontier");
      return {
        ...shared("TIE", frontierCandidateIds),
        outcome: "TIE",
        frontierCandidateIds: multipleDecisionIds(frontierCandidateIds, "TIE frontier"),
        tiedCandidateIds,
        materialUnknowns: [],
      };
    }
    case "INSUFFICIENT_EVIDENCE":
      return {
        ...shared("INSUFFICIENT_EVIDENCE", frontierCandidateIds),
        outcome: "INSUFFICIENT_EVIDENCE",
        frontierCandidateIds: nonEmptyDecisionIds(frontierCandidateIds, "INSUFFICIENT_EVIDENCE frontier"),
        tiedCandidateIds: [],
        materialUnknowns: nonEmptyDecisionIds(materialUnknowns, "INSUFFICIENT_EVIDENCE material unknowns"),
      };
    case "UNRESOLVED":
      return {
        ...shared("UNRESOLVED", frontierCandidateIds),
        outcome: "UNRESOLVED",
        frontierCandidateIds,
        tiedCandidateIds: [],
        materialUnknowns: nonEmptyDecisionIds(materialUnknowns, "UNRESOLVED material unknowns"),
      };
    case "NO_ELIGIBLE_CANDIDATE":
      throw new Error("Material dominance reported no eligible candidate after eligibility was already established.");
  }
}
