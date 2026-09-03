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

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
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

  let winnerCandidateId: string | undefined;
  let winnerLabel: string | undefined;
  if (decision.winnerCandidateId) {
    const winner = candidateById.get(decision.winnerCandidateId);
    if (!winner) {
      throw new Error("Structured decision references an unknown winning candidate.");
    }
    const winnerEvaluation = candidateViews.find((evaluation) => evaluation.candidateId === winner.id);
    if (!winnerEvaluation?.eligible) {
      throw new Error("Solandra cannot explain a winner that is not eligible in the authoritative decision.");
    }
    winnerCandidateId = decision.winnerCandidateId;
    winnerLabel = winner.label;
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
    outcome: decision.outcome ?? (winnerCandidateId ? "RECOMMENDATION" : "UNRESOLVED"),
    ...(winnerCandidateId && winnerLabel ? { winnerCandidateId, winnerLabel } : {}),
    frontierCandidateIds: [...(decision.frontierCandidateIds ?? (winnerCandidateId ? [winnerCandidateId] : []))],
    tiedCandidateIds: [...(decision.tiedCandidateIds ?? [])],
    materialUnknowns: [...(decision.materialUnknowns ?? [])],
    candidates: candidateViews,
    rationale: [...decision.rationale],
    evidenceIds: [...decision.evidenceIds],
    truthAssessmentIds: [...decision.truthAssessmentIds],
    truthReferences,
  };
}
