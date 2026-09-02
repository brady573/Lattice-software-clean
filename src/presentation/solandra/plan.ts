import type { Candidate, StructuredDecision } from "../../domain.js";
import { assertDecisionTruthFidelity } from "../../truth/fidelity.js";
import type { TruthBundle } from "../../truth/types.js";
import type {
  SolandraCandidateView,
  SolandraExplanationPlan,
  SolandraTruthReference,
} from "./types.js";

export function createSolandraExplanationPlan(
  decision: StructuredDecision,
  candidates: readonly Candidate[],
  bundle: TruthBundle,
): SolandraExplanationPlan {
  assertDecisionTruthFidelity(decision, bundle);
  if (!decision.winnerCandidateId) {
    throw new Error("Solandra explanation plan requires a selected winner; preserve the authoritative outcome instead.");
  }

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const winner = candidateById.get(decision.winnerCandidateId);
  if (!winner) {
    throw new Error("Structured decision references an unknown winning candidate.");
  }

  const candidateViews: SolandraCandidateView[] = decision.evaluations.map((evaluation) => {
    const candidate = candidateById.get(evaluation.candidateId);
    if (!candidate) {
      throw new Error(`Structured decision references an unknown candidate: ${evaluation.candidateId}`);
    }
    return {
      candidateId: evaluation.candidateId,
      label: candidate.label,
      eligible: evaluation.eligible,
      rawScore: evaluation.rawScore,
      normalizedScore: evaluation.normalizedScore,
      constraints: evaluation.constraints.map((constraint) => ({ ...constraint })),
    };
  });

  const winnerEvaluation = candidateViews.find((evaluation) => evaluation.candidateId === winner.id);
  if (!winnerEvaluation?.eligible) {
    throw new Error("Solandra cannot explain a winner that is not eligible in the authoritative decision.");
  }

  const assessmentById = new Map(bundle.assessments.map((assessment) => [assessment.id, assessment]));
  const truthReferences: SolandraTruthReference[] = decision.truthAssessmentIds.map((assessmentId) => {
    const assessment = assessmentById.get(assessmentId);
    if (!assessment) {
      throw new Error(`Structured decision references an unknown truth assessment: ${assessmentId}`);
    }
    return {
      assessmentId,
      verdict: assessment.verdict,
      confidence: assessment.confidence,
      admittedEvidenceIds: [...assessment.admittedEvidenceIds],
      contradictoryEvidenceIds: [...assessment.contradictoryEvidenceIds],
      unresolvedObligationIds: [...assessment.unresolvedObligationIds],
    };
  });

  return {
    goal: decision.goal,
    winnerCandidateId: decision.winnerCandidateId,
    winnerLabel: winner.label,
    candidates: candidateViews,
    rationale: [...decision.rationale],
    evidenceIds: [...decision.evidenceIds],
    truthAssessmentIds: [...decision.truthAssessmentIds],
    truthReferences,
  };
}
