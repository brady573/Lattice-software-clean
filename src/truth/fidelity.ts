import type { Candidate, StructuredDecision } from "../domain.js";
import type { TruthBundle } from "./types.js";

export function assertDecisionTruthFidelity(
  decision: StructuredDecision,
  bundle: TruthBundle,
): void {
  const admitted = new Set(
    bundle.assessments
      .filter((assessment) => assessment.verdict === "TRUE")
      .flatMap((assessment) => assessment.admittedEvidenceIds),
  );
  for (const evidenceId of decision.evidenceIds) {
    if (!admitted.has(evidenceId)) {
      throw new Error(`Decision references evidence that V36 did not admit as material TRUE: ${evidenceId}`);
    }
  }
  const assessmentIds = new Set(bundle.assessments.map((assessment) => assessment.id));
  for (const assessmentId of decision.truthAssessmentIds) {
    if (!assessmentIds.has(assessmentId)) {
      throw new Error(`Decision references a truth assessment outside the persisted bundle: ${assessmentId}`);
    }
  }
}

export function renderCanonicalExplanation(
  decision: StructuredDecision,
  candidates: Candidate[],
): string {
  const winner = candidates.find((candidate) => candidate.id === decision.winnerCandidateId);
  if (!winner) throw new Error("Structured decision references an unknown winning candidate.");
  const winnerEvaluation = decision.evaluations.find((evaluation) => evaluation.candidateId === winner.id);
  if (!winnerEvaluation?.eligible) {
    throw new Error("Solandra cannot explain a winner that is not eligible in the authoritative decision.");
  }
  const excluded = decision.evaluations.filter((evaluation) => !evaluation.eligible);
  const exclusions = excluded.length > 0
    ? ` ${excluded.length} candidate(s) were excluded because admitted evidence did not satisfy every hard constraint.`
    : "";
  return `Solandra recommends ${winner.label}. It satisfies every hard constraint and has the strongest weighted preference score among the remaining eligible candidates.${exclusions}`;
}

export function assertExplanationTruthFidelity(
  explanation: string,
  decision: StructuredDecision,
  candidates: Candidate[],
  bundle: TruthBundle,
): void {
  assertDecisionTruthFidelity(decision, bundle);
  const canonical = renderCanonicalExplanation(decision, candidates);
  if (explanation !== canonical) {
    throw new Error("Explanation diverges from the persisted StructuredDecision or introduces unsupported material content.");
  }
}
