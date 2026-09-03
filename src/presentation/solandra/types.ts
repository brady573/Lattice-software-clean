import type { DecisionOutcome, EvidenceValue } from "../../domain.js";
import type { MaterialVerdict, TruthConfidence } from "../../truth/types.js";

export interface SolandraConstraintView {
  criterion: string;
  passed: boolean | null;
  observed: EvidenceValue;
  expected: EvidenceValue;
}

export interface SolandraCandidateView {
  candidateId: string;
  label: string;
  eligible: boolean;
  rawScore: number;
  normalizedScore: number;
  constraints: readonly SolandraConstraintView[];
}

export interface SolandraTruthReference {
  assessmentId: string;
  verdict: MaterialVerdict;
  confidence: TruthConfidence;
  admittedEvidenceIds: readonly string[];
  contradictoryEvidenceIds: readonly string[];
  unresolvedObligationIds: readonly string[];
}

/**
 * Derived presentation state only. This plan is licensed by persisted upstream
 * authority and must never become a second decision or truth record.
 *
 * A decision may deliberately preserve a non-winner outcome (FRONTIER, TIE,
 * INSUFFICIENT_EVIDENCE, UNRESOLVED, NO_ELIGIBLE_CANDIDATE); `winnerCandidateId`
 * and `winnerLabel` remain absent for those outcomes rather than being
 * fabricated.
 */
export interface SolandraExplanationPlan {
  goal: string;
  outcome: DecisionOutcome;
  winnerCandidateId?: string;
  winnerLabel?: string;
  frontierCandidateIds: readonly string[];
  tiedCandidateIds: readonly string[];
  materialUnknowns: readonly string[];
  candidates: readonly SolandraCandidateView[];
  rationale: readonly string[];
  evidenceIds: readonly string[];
  truthAssessmentIds: readonly string[];
  truthReferences: readonly SolandraTruthReference[];
}
