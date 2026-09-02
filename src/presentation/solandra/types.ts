import type { EvidenceValue } from "../../domain.js";
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
 */
export interface SolandraExplanationPlan {
  goal: string;
  winnerCandidateId: string;
  winnerLabel: string;
  candidates: readonly SolandraCandidateView[];
  rationale: readonly string[];
  evidenceIds: readonly string[];
  truthAssessmentIds: readonly string[];
  truthReferences: readonly SolandraTruthReference[];
}
