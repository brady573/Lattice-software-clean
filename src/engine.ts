import type {
  Candidate,
  CandidateEvaluation,
  ConstraintResult,
  EvidenceValue,
  HardConstraint,
  Priority,
  RunRequest,
  StructuredDecision,
} from "./domain.js";
import type { DecisionFixtureDataset } from "./truth/fixture-dataset.js";
import {
  createSolandraExplanationPlan,
  renderCanonicalExplanation,
} from "./presentation/solandra/index.js";
import {
  assertAdmittedDecisionEvidence,
  type AdmittedDecisionEvidence,
} from "./truth/admission.js";
import { evaluateFixtureTruth } from "./truth/fixture-evaluation.js";
import { materializeFixtureDecisionEvidence } from "./truth/decision-evidence-provider.js";

const deterministicEvaluationRunId = "00000000-0000-4000-8000-000000000036";

function compareConstraint(observed: EvidenceValue, constraint: HardConstraint): boolean | null {
  if (observed === null || observed === undefined) return null;
  switch (constraint.operator) {
    case "eq": return observed === constraint.value;
    case "lte": return typeof observed === "number" && typeof constraint.value === "number" ? observed <= constraint.value : null;
    case "gte": return typeof observed === "number" && typeof constraint.value === "number" ? observed >= constraint.value : null;
  }
  return null;
}

function decisionEvidenceFor(
  evidence: readonly AdmittedDecisionEvidence[],
  candidateId: string,
  criterion: string,
): AdmittedDecisionEvidence | undefined {
  return evidence.find((item) => item.candidateId === candidateId && item.criterion === criterion);
}

function evaluateConstraints(
  candidate: Candidate,
  constraints: HardConstraint[],
  evidence: readonly AdmittedDecisionEvidence[],
): ConstraintResult[] {
  return constraints.map((constraint) => {
    const item = decisionEvidenceFor(evidence, candidate.id, constraint.criterion);
    const observed = item?.value ?? null;
    return { criterion: constraint.criterion, passed: compareConstraint(observed, constraint), observed, expected: constraint.value };
  });
}

function normalizedPreferenceUtility(
  candidate: Candidate,
  priorities: Priority[],
  evidence: readonly AdmittedDecisionEvidence[],
  candidates: readonly Candidate[],
): number {
  const totalWeight = priorities.reduce((total, priority) => total + priority.weight, 0);
  if (totalWeight === 0) return 0;
  return priorities.reduce((total, priority) => {
    const item = decisionEvidenceFor(evidence, candidate.id, priority.criterion);
    if (!item || typeof item.value !== "number") return total;
    const comparable = candidates.flatMap((alternative) => {
      const value = decisionEvidenceFor(evidence, alternative.id, priority.criterion)?.value;
      return typeof value === "number" && Number.isFinite(value) ? [value] : [];
    });
    if (comparable.length === 0) return total;
    const minimum = Math.min(...comparable);
    const maximum = Math.max(...comparable);
    const criterionUtility = maximum === minimum ? 1 : (item.value - minimum) / (maximum - minimum);
    return total + criterionUtility * (priority.weight / totalWeight);
  }, 0);
}

function normalizeScores(evaluations: CandidateEvaluation[]): CandidateEvaluation[] {
  const eligible = evaluations.filter((evaluation) => evaluation.eligible);
  const max = Math.max(...eligible.map((evaluation) => evaluation.rawScore), 0);
  if (max === 0) return evaluations;
  return evaluations.map((evaluation) => ({ ...evaluation, normalizedScore: evaluation.eligible ? evaluation.rawScore / max : 0 }));
}

export function createDecisionFromAdmittedEvidence(
  request: RunRequest,
  candidates: Candidate[],
  evidence: readonly AdmittedDecisionEvidence[],
  truthAssessmentIds: string[],
): StructuredDecision {
  assertAdmittedDecisionEvidence(evidence);

  const evaluations = candidates.map<CandidateEvaluation>((candidate) => {
    const constraints = evaluateConstraints(candidate, request.hardConstraints, evidence);
    const eligible = constraints.every((constraint) => constraint.passed === true);
    const supportingEvidenceIds = evidence
      .filter((item) => item.candidateId === candidate.id)
      .map((item) => item.id);
    return {
      candidateId: candidate.id,
      eligible,
      // Historical field name; the value is scale-normalized criterion utility.
      rawScore: normalizedPreferenceUtility(candidate, request.priorities, evidence, candidates),
      normalizedScore: 0,
      constraints,
      supportingEvidenceIds,
    };
  });
  const normalized = normalizeScores(evaluations);
  const unresolved = normalized.flatMap((evaluation) =>
    evaluation.constraints.filter((constraint) => constraint.passed === null)
      .map((constraint) => `${evaluation.candidateId}:${constraint.criterion}`));
  if (unresolved.length > 0) {
    return {
      goal: request.goal,
      outcome: "UNRESOLVED",
      frontierCandidateIds: normalized.filter((evaluation) => evaluation.eligible)
        .map((evaluation) => evaluation.candidateId),
      tiedCandidateIds: [],
      materialUnknowns: unresolved,
      evaluations: normalized,
      rationale: ["The available evidence leaves at least one candidate's eligibility unresolved, so no winner is forced."],
      evidenceIds: [],
      truthAssessmentIds,
    };
  }
  const eligible = normalized.filter((evaluation) => evaluation.eligible).sort((left, right) => right.rawScore - left.rawScore);
  const winner = eligible[0];
  if (!winner) {
    return {
      goal: request.goal,
      outcome: "NO_ELIGIBLE_CANDIDATE",
      frontierCandidateIds: [],
      tiedCandidateIds: [],
      materialUnknowns: [],
      evaluations: normalized,
      rationale: ["No candidate satisfies every hard constraint with admitted evidence."],
      evidenceIds: [],
      truthAssessmentIds,
    };
  }
  const candidateLabel = candidates.find((candidate) => candidate.id === winner.candidateId)?.label ?? winner.candidateId;
  const tied = eligible.filter((evaluation) => evaluation.rawScore === winner.rawScore);
  if (tied.length > 1) {
    return {
      goal: request.goal,
      outcome: "TIE",
      frontierCandidateIds: tied.map((evaluation) => evaluation.candidateId),
      tiedCandidateIds: tied.map((evaluation) => evaluation.candidateId),
      materialUnknowns: [],
      evaluations: normalized,
      rationale: ["Eligible candidates have equal weighted preference scores; no single recommendation is supported."],
      evidenceIds: [],
      truthAssessmentIds,
    };
  }
  const disqualifiedHigherScorers = normalized.filter((evaluation) => !evaluation.eligible && evaluation.rawScore > winner.rawScore);
  const rationale = [`${candidateLabel} satisfies every hard constraint and has the highest weighted score among eligible candidates.`];
  if (disqualifiedHigherScorers.length > 0) rationale.push(`${disqualifiedHigherScorers.length} candidate(s) scored higher on preferences but were excluded by hard constraints.`);
  return {
    goal: request.goal,
    outcome: "RECOMMENDATION",
    frontierCandidateIds: [winner.candidateId],
    tiedCandidateIds: [],
    materialUnknowns: [],
    winnerCandidateId: winner.candidateId,
    evaluations: normalized,
    rationale,
    evidenceIds: [...new Set(winner.supportingEvidenceIds)],
    truthAssessmentIds,
  };
}

export function createDecision(request: RunRequest, dataset: DecisionFixtureDataset): StructuredDecision {
  const truth = evaluateFixtureTruth(deterministicEvaluationRunId, dataset);
  return createDecisionFromAdmittedEvidence(
    request,
    dataset.candidates,
    materializeFixtureDecisionEvidence(dataset, truth.bundle),
    truth.assessments.map((assessment) => assessment.id),
  );
}

export function explainDecision(decision: StructuredDecision, dataset: DecisionFixtureDataset): string {
  const truth = evaluateFixtureTruth(deterministicEvaluationRunId, dataset);
  const plan = createSolandraExplanationPlan(decision, dataset.candidates, truth.bundle);
  return renderCanonicalExplanation(plan);
}
