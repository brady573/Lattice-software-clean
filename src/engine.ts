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
import type { FixtureDataset } from "./fixtures.js";
import {
  createSolandraExplanationPlan,
  renderCanonicalExplanation,
} from "./presentation/solandra/index.js";
import {
  assertAdmittedDecisionEvidence,
  type AdmittedDecisionEvidence,
} from "./truth/admission.js";
import { evaluateFixtureTruth } from "./truth/fixture-evaluation.js";

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

function rawPreferenceScore(
  candidate: Candidate,
  priorities: Priority[],
  evidence: readonly AdmittedDecisionEvidence[],
): number {
  const totalWeight = priorities.reduce((total, priority) => total + priority.weight, 0);
  if (totalWeight === 0) return 0;
  return priorities.reduce((total, priority) => {
    const item = decisionEvidenceFor(evidence, candidate.id, priority.criterion);
    if (!item || typeof item.value !== "number") return total;
    return total + item.value * (priority.weight / totalWeight);
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
      rawScore: rawPreferenceScore(candidate, request.priorities, evidence),
      normalizedScore: 0,
      constraints,
      supportingEvidenceIds,
    };
  });
  const normalized = normalizeScores(evaluations);
  const eligible = normalized.filter((evaluation) => evaluation.eligible).sort((left, right) => right.rawScore - left.rawScore);
  const winner = eligible[0];
  if (!winner) throw new Error("No candidate satisfies all hard constraints with admitted evidence.");
  const candidateLabel = candidates.find((candidate) => candidate.id === winner.candidateId)?.label ?? winner.candidateId;
  const disqualifiedHigherScorers = normalized.filter((evaluation) => !evaluation.eligible && evaluation.rawScore > winner.rawScore);
  const rationale = [`${candidateLabel} satisfies every hard constraint and has the highest weighted score among eligible candidates.`];
  if (disqualifiedHigherScorers.length > 0) rationale.push(`${disqualifiedHigherScorers.length} candidate(s) scored higher on preferences but were excluded by hard constraints.`);
  return {
    goal: request.goal,
    winnerCandidateId: winner.candidateId,
    evaluations: normalized,
    rationale,
    evidenceIds: [...new Set(winner.supportingEvidenceIds)],
    truthAssessmentIds,
  };
}

export function createDecision(request: RunRequest, dataset: FixtureDataset): StructuredDecision {
  const truth = evaluateFixtureTruth(deterministicEvaluationRunId, dataset);
  return createDecisionFromAdmittedEvidence(
    request,
    dataset.candidates,
    truth.decisionEvidence,
    truth.assessments.map((assessment) => assessment.id),
  );
}

export function explainDecision(decision: StructuredDecision, dataset: FixtureDataset): string {
  const truth = evaluateFixtureTruth(deterministicEvaluationRunId, dataset);
  const plan = createSolandraExplanationPlan(decision, dataset.candidates, truth.bundle);
  return renderCanonicalExplanation(plan);
}
