import type { Candidate, EvidenceValue, LatticeRun } from "../../domain.js";
import type { TruthBundle } from "../../truth/types.js";
import { createSolandraExplanationPlan } from "./plan.js";

export type ConsultationRequirementStatus = "satisfied" | "failed" | "unknown";

export interface ConsultationRequirement {
  criterion: string;
  label: string;
  operator: "lte" | "gte" | "eq";
  expected: EvidenceValue;
  status: ConsultationRequirementStatus;
  observed: EvidenceValue;
}

export interface ConsultationPriority {
  criterion: string;
  label: string;
  rank: number;
}

export interface ConsultationAlternative {
  candidateId: string;
  label: string;
  eligible: boolean;
  requirementEffects: readonly ConsultationRequirement[];
}

export interface ConsultationEvidenceSource {
  evidenceId: string;
  sourceLabel: string;
  canonicalUri: string;
  relation: "SUPPORTS" | "CONTRADICTS" | "CONTEXT" | "NEUTRAL";
  verification: "VERIFIED" | "UNVERIFIED" | "REJECTED";
  retrievedAt: string;
  publishedAt: string | null;
}

export interface ConsultationEvidenceTrace {
  assessmentId: string;
  claim: string;
  verdict: string;
  sources: readonly ConsultationEvidenceSource[];
  contradictoryEvidenceIds: readonly string[];
  unresolvedObligationIds: readonly string[];
}

export interface ConsultationProjection {
  runId: string;
  status: "COMPLETED";
  conversation: {
    goal: string;
    requirements: readonly ConsultationRequirement[];
    priorities: readonly ConsultationPriority[];
  };
  result: {
    recommendation: {
      candidateId: string;
      label: string;
      explanation: string;
      requirementEffects: readonly ConsultationRequirement[];
    };
    alternatives: readonly ConsultationAlternative[];
  };
  evidenceTraces: readonly ConsultationEvidenceTrace[];
}

function labelCriterion(criterion: string): string {
  const spaced = criterion
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.length === 0
    ? criterion
    : `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function requirementStatus(passed: boolean | null): ConsultationRequirementStatus {
  if (passed === true) return "satisfied";
  if (passed === false) return "failed";
  return "unknown";
}

function requirementsForCandidate(
  run: LatticeRun,
  candidateId: string,
): ConsultationRequirement[] {
  const evaluation = run.decision?.evaluations.find((item) => item.candidateId === candidateId);
  if (!evaluation) throw new Error(`Decision is missing candidate evaluation: ${candidateId}`);

  return run.request.hardConstraints.map((constraint) => {
    const result = evaluation.constraints.find((item) => item.criterion === constraint.criterion);
    return {
      criterion: constraint.criterion,
      label: labelCriterion(constraint.criterion),
      operator: constraint.operator,
      expected: constraint.value,
      status: requirementStatus(result?.passed ?? null),
      observed: result?.observed ?? null,
    };
  });
}

export function createSolandraConsultationProjection(
  run: LatticeRun,
  candidates: readonly Candidate[],
  bundle: TruthBundle,
): ConsultationProjection {
  if (run.status !== "COMPLETED" || !run.decision || !run.explanation) {
    throw new Error("Consultation projection requires a completed Run with persisted decision and explanation.");
  }
  if (bundle.runId !== run.id) {
    throw new Error("Consultation projection truth bundle belongs to a different Run.");
  }

  const plan = createSolandraExplanationPlan(run.decision, candidates, bundle);
  const priorities = [...run.request.priorities]
    .sort((a, b) => b.weight - a.weight || a.criterion.localeCompare(b.criterion))
    .map((priority, index) => ({
      criterion: priority.criterion,
      label: labelCriterion(priority.criterion),
      rank: index + 1,
    }));

  const recommendation = {
    candidateId: plan.winnerCandidateId,
    label: plan.winnerLabel,
    explanation: run.explanation,
    requirementEffects: requirementsForCandidate(run, plan.winnerCandidateId),
  };

  const alternatives = plan.candidates
    .filter((candidate) => candidate.candidateId !== plan.winnerCandidateId)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      label: candidate.label,
      eligible: candidate.eligible,
      requirementEffects: requirementsForCandidate(run, candidate.candidateId),
    }));

  const evidenceById = new Map(bundle.claimEvidence.map((item) => [item.id, item]));
  const evidenceByExternalId = new Map(bundle.claimEvidence.map((item) => [item.externalEvidenceId, item]));
  const sourceById = new Map(bundle.sources.map((source) => [source.id, source]));
  const claimById = new Map(bundle.claims.map((claim) => [claim.id, claim]));
  const assessmentById = new Map(bundle.assessments.map((assessment) => [assessment.id, assessment]));

  const evidenceTraces = plan.truthReferences.map((reference) => {
    const assessment = assessmentById.get(reference.assessmentId);
    if (!assessment) throw new Error(`Missing truth assessment: ${reference.assessmentId}`);
    const claim = claimById.get(assessment.claimId);
    if (!claim) throw new Error(`Missing claim for truth assessment: ${reference.assessmentId}`);

    const sources = reference.admittedEvidenceIds.map((evidenceId) => {
      const evidence = evidenceById.get(evidenceId) ?? evidenceByExternalId.get(evidenceId);
      if (!evidence) throw new Error(`Missing admitted evidence: ${evidenceId}`);
      const source = sourceById.get(evidence.artifactId);
      if (!source) throw new Error(`Missing source artifact for evidence: ${evidenceId}`);
      return {
        evidenceId,
        sourceLabel: source.publisher ?? source.canonicalUri,
        canonicalUri: source.canonicalUri,
        relation: evidence.relation,
        verification: evidence.verification,
        retrievedAt: source.retrievedAt,
        publishedAt: source.publishedAt,
      };
    });

    return {
      assessmentId: reference.assessmentId,
      claim: claim.text,
      verdict: reference.verdict,
      sources,
      contradictoryEvidenceIds: [...reference.contradictoryEvidenceIds],
      unresolvedObligationIds: [...reference.unresolvedObligationIds],
    };
  });

  return {
    runId: run.id,
    status: "COMPLETED",
    conversation: {
      goal: run.request.goal,
      requirements: requirementsForCandidate(run, plan.winnerCandidateId),
      priorities,
    },
    result: {
      recommendation,
      alternatives,
    },
    evidenceTraces,
  };
}
