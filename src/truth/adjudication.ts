import { adjudicateAtomicEvidence } from "./atomic-core.js";
import { requiredProofObligations } from "./contracts.js";
import { evaluatePositiveBurden } from "./positive-burden.js";
import type {
  ClaimEvidence,
  CompiledClaim,
  ProofCheck,
  ProofObligation,
  TruthAssessment,
} from "./types.js";

export interface AdjudicationInput {
  assessmentId: string;
  claim: CompiledClaim;
  obligations: ProofObligation[];
  checks: ProofCheck[];
  evidence: ClaimEvidence[];
  materiallyMisleading?: boolean;
}

function unresolvedRequiredObligations(input: AdjudicationInput): ProofObligation[] {
  const requiredKinds = new Set(requiredProofObligations(input.claim.claimType));
  const checksByObligation = new Map(input.checks.map((check) => [check.obligationId, check]));
  return input.obligations.filter((obligation) => {
    if (!obligation.required || !requiredKinds.has(obligation.kind)) return false;
    const check = checksByObligation.get(obligation.id);
    return !check || check.status !== "PASSED";
  });
}

export function adjudicateClaim(input: AdjudicationInput): TruthAssessment {
  const unresolved = unresolvedRequiredObligations(input);
  const verified = input.evidence.filter(
    (item) => item.admitted && item.verification === "VERIFIED",
  );
  const supports = verified.filter((item) => item.relation === "SUPPORTS");
  const contradictions = verified.filter((item) => item.relation === "CONTRADICTS");
  const atomicDisposition = adjudicateAtomicEvidence(input.evidence);

  if (input.claim.claimType === "OPINION") {
    return {
      id: input.assessmentId,
      runId: input.claim.runId,
      claimId: input.claim.id,
      atomicDisposition,
      verdict: "OPINION",
      confidence: unresolved.length === 0 ? "HIGH" : "LOW",
      admittedEvidenceIds: [],
      contradictoryEvidenceIds: contradictions.map((item) => item.externalEvidenceId),
      unresolvedObligationIds: unresolved.map((item) => item.id),
      rationale: [
        unresolved.length === 0
          ? "The claim is not meaningfully fact-checkable and is not forced into TRUE/FALSE."
          : "Opinion classification remains explicit, but fact-checkability proof is incomplete.",
      ],
    };
  }

  const temporalFailure = input.claim.claimType === "CURRENT_STATE" && input.checks.some(
    (check) => check.kind === "TEMPORAL_APPLICABILITY" && check.status === "FAILED",
  );
  if (temporalFailure) {
    return {
      id: input.assessmentId,
      runId: input.claim.runId,
      claimId: input.claim.id,
      atomicDisposition,
      verdict: "OUTDATED",
      confidence: "MODERATE",
      admittedEvidenceIds: [],
      contradictoryEvidenceIds: contradictions.map((item) => item.externalEvidenceId),
      unresolvedObligationIds: unresolved.map((item) => item.id),
      rationale: ["The evidence was once applicable but fails current temporal applicability."],
    };
  }

  if (input.materiallyMisleading === true) {
    return {
      id: input.assessmentId,
      runId: input.claim.runId,
      claimId: input.claim.id,
      atomicDisposition,
      verdict: "MISLEADING",
      confidence: unresolved.length === 0 ? "HIGH" : "MODERATE",
      admittedEvidenceIds: [],
      contradictoryEvidenceIds: contradictions.map((item) => item.externalEvidenceId),
      unresolvedObligationIds: unresolved.map((item) => item.id),
      rationale: ["A literal fragment is insufficient because material context, scope, or qualifiers change its meaning."],
    };
  }

  // Material conflict is surfaced before applying the asymmetric positive-release burden.
  // The positive burden can block TRUE; it must not erase verified contradictory evidence.
  if (atomicDisposition === "CONFLICT") {
    return {
      id: input.assessmentId,
      runId: input.claim.runId,
      claimId: input.claim.id,
      atomicDisposition,
      verdict: "MIXED",
      confidence: unresolved.length === 0 ? "MODERATE" : "LOW",
      admittedEvidenceIds: [],
      contradictoryEvidenceIds: contradictions.map((item) => item.externalEvidenceId),
      unresolvedObligationIds: unresolved.map((item) => item.id),
      rationale: ["Verified admitted evidence contains both support and contradiction."],
    };
  }

  if (unresolved.length > 0) {
    return {
      id: input.assessmentId,
      runId: input.claim.runId,
      claimId: input.claim.id,
      atomicDisposition,
      verdict: "UNVERIFIED",
      confidence: "LOW",
      admittedEvidenceIds: [],
      contradictoryEvidenceIds: contradictions.map((item) => item.externalEvidenceId),
      unresolvedObligationIds: unresolved.map((item) => item.id),
      rationale: ["One or more mandatory typed proof obligations are unresolved or failed."],
    };
  }

  if (atomicDisposition === "SUPPORTED") {
    const burden = evaluatePositiveBurden(input.claim, input.evidence);
    if (!burden.satisfied) {
      return {
        id: input.assessmentId,
        runId: input.claim.runId,
        claimId: input.claim.id,
        atomicDisposition,
        verdict: "UNVERIFIED",
        confidence: "LOW",
        admittedEvidenceIds: [],
        contradictoryEvidenceIds: [],
        unresolvedObligationIds: [],
        rationale: [burden.reason],
      };
    }
    return {
      id: input.assessmentId,
      runId: input.claim.runId,
      claimId: input.claim.id,
      atomicDisposition,
      verdict: "TRUE",
      confidence: "HIGH",
      admittedEvidenceIds: supports.map((item) => item.externalEvidenceId),
      contradictoryEvidenceIds: [],
      unresolvedObligationIds: [],
      rationale: [burden.reason],
    };
  }

  if (atomicDisposition === "REFUTED") {
    return {
      id: input.assessmentId,
      runId: input.claim.runId,
      claimId: input.claim.id,
      atomicDisposition,
      verdict: "FALSE",
      confidence: "HIGH",
      admittedEvidenceIds: [],
      contradictoryEvidenceIds: contradictions.map((item) => item.externalEvidenceId),
      unresolvedObligationIds: [],
      rationale: ["Verified admitted contradiction refutes the material claim."],
    };
  }

  return {
    id: input.assessmentId,
    runId: input.claim.runId,
    claimId: input.claim.id,
    atomicDisposition,
    verdict: "UNVERIFIED",
    confidence: "LOW",
    admittedEvidenceIds: [],
    contradictoryEvidenceIds: [],
    unresolvedObligationIds: [],
    rationale: ["No verified admissible support or contradiction was established."],
  };
}
