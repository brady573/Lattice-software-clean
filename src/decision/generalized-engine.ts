import type {
  Candidate,
  CandidateEvaluation,
  DecisionOutcome,
  StructuredDecision,
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

function rationaleFor(outcome: DecisionOutcome): string {
  switch (outcome) {
    case "RECOMMENDATION":
      return "One eligible alternative materially dominates the others under the qualified criterion semantics.";
    case "FRONTIER":
      return "More than one eligible alternative remains nondominated; no scalar score or forced winner was manufactured.";
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

  let outcome: DecisionOutcome;
  let frontierCandidateIds: string[];
  let tiedCandidateIds: string[] = [];
  let materialUnknowns: string[] = [];

  if (unknownEligibility.length > 0) {
    outcome = "INSUFFICIENT_EVIDENCE";
    frontierCandidateIds = [...eligibleIds, ...unknownEligibility];
    materialUnknowns = evaluations.flatMap((evaluation) => evaluation.constraints
      .filter((constraint) => constraint.passed === null)
      .map((constraint) => `${evaluation.candidateId}:${constraint.criterion}`));
  } else if (eligibleIds.length === 0) {
    outcome = "NO_ELIGIBLE_CANDIDATE";
    frontierCandidateIds = [];
  } else if (input.priorities.length === 0) {
    outcome = eligibleIds.length === 1 ? "RECOMMENDATION" : "FRONTIER";
    frontierCandidateIds = eligibleIds;
  } else {
    const comparisons = [];
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
          materialUnknowns.push(`${leftAlternativeId}:${rightAlternativeId}:missing-admitted-evidence`);
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
    outcome = frontier.outcome;
    frontierCandidateIds = [...frontier.frontierAlternativeIds];
    tiedCandidateIds = outcome === "TIE" ? [...frontier.frontierAlternativeIds] : [];
    materialUnknowns.push(...frontier.pairwiseDecisions.flatMap((decision) => decision.unresolvedCriteria));
  }

  const winnerCandidateId = outcome === "RECOMMENDATION" && frontierCandidateIds.length === 1
    ? frontierCandidateIds[0]
    : undefined;
  const relevantCandidateIds = new Set(winnerCandidateId ? [winnerCandidateId] : frontierCandidateIds);
  const evidenceIds = [...new Set(evidence
    .filter((item) => relevantCandidateIds.has(item.candidateId))
    .map((item) => item.id))];

  return {
    goal: input.objective,
    outcome,
    ...(winnerCandidateId ? { winnerCandidateId } : {}),
    frontierCandidateIds,
    tiedCandidateIds,
    materialUnknowns: [...new Set(materialUnknowns)],
    evaluations,
    rationale: [rationaleFor(outcome)],
    evidenceIds,
    truthAssessmentIds: [...truthAssessmentIds],
  };
}
