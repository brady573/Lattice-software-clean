import type { Candidate, StructuredDecision } from "../domain.js";
import type { QualifiedCriterionCatalog } from "./criterion-catalog.js";
import { evaluateHardRequirement, hardRequirementsPermitEligibility } from "./priority-and-requirements.js";
import type { DecisionInputSnapshot } from "./decision-input-snapshot.js";
import type { AdmittedDecisionEvidence } from "../truth/admission.js";

function valueFor(
  evidence: readonly AdmittedDecisionEvidence[],
  candidateId: string,
  criterionId: string,
): string | number | boolean | null {
  return evidence.find((item) => item.candidateId === candidateId && item.criterion === criterionId)?.value ?? null;
}

const tierWeight = {
  MUST_HAVE: 4,
  MATTERS_MOST: 3,
  IMPORTANT: 2,
  NICE_TO_HAVE: 1,
} as const;

export function createGeneralizedDecisionFromAdmittedEvidence(
  input: DecisionInputSnapshot,
  catalog: QualifiedCriterionCatalog,
  candidates: readonly Candidate[],
  evidence: readonly AdmittedDecisionEvidence[],
  truthAssessmentIds: readonly string[],
): StructuredDecision {
  const evaluations = candidates.map((candidate) => {
    const constraints = input.hardRequirements.map((requirement) => {
      const observed = valueFor(evidence, candidate.id, requirement.criterionId);
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
    const eligible = hardRequirementsPermitEligibility(constraints.map((constraint) =>
      constraint.passed === true ? "SATISFIED" : constraint.passed === false ? "FAILED" : "UNKNOWN"));
    const rawScore = input.priorities.reduce((score, priority) => {
      const value = valueFor(evidence, candidate.id, priority.criterionId);
      if (typeof value !== "number") return score;
      const definition = catalog.requireExact(priority.criterionId, priority.criterionVersion);
      const direction = definition.preferenceDirection === "LOWER_IS_BETTER" ? -1 : 1;
      return score + direction * value * tierWeight[priority.tier];
    }, 0);
    return {
      candidateId: candidate.id,
      eligible,
      rawScore,
      normalizedScore: 0,
      constraints,
      supportingEvidenceIds: evidence.filter((item) => item.candidateId === candidate.id).map((item) => item.id),
    };
  });
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);
  if (eligible.length === 0) throw new Error("No candidate satisfies all hard requirements with admitted evidence.");
  const max = Math.max(...eligible.map((evaluation) => evaluation.rawScore));
  const min = Math.min(...eligible.map((evaluation) => evaluation.rawScore));
  const normalized = evaluations.map((evaluation) => ({
    ...evaluation,
    normalizedScore: evaluation.eligible && max !== min
      ? (evaluation.rawScore - min) / (max - min)
      : evaluation.eligible ? 1 : 0,
  }));
  const winner = normalized.find((evaluation) => evaluation.eligible && evaluation.rawScore === max)!;
  const label = candidates.find((candidate) => candidate.id === winner.candidateId)?.label ?? winner.candidateId;
  return {
    goal: input.objective,
    winnerCandidateId: winner.candidateId,
    evaluations: normalized,
    rationale: [`${label} satisfies every hard requirement and has the highest qualified preference score among eligible candidates.`],
    evidenceIds: [...new Set(winner.supportingEvidenceIds)],
    truthAssessmentIds: [...truthAssessmentIds],
  };
}
