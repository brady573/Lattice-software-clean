import { stableTruthUuid } from "./ids.js";
import type { ClaimEvidence, CompiledClaim } from "./types.js";
import {
  researchWithAdmission,
  type ResearchRequest,
  type TruthResearchProvider,
  type TruthResearchResult,
} from "./pipeline.js";
import { mergeClaimEvidenceStrict } from "./state-merge.js";

export function shouldRouteFalsification(
  claim: CompiledClaim,
  evidence: ClaimEvidence[],
): boolean {
  const support = evidence.filter(
    (item) => item.admitted && item.verification === "VERIFIED" && item.relation === "SUPPORTS",
  );
  if (support.length === 0) return false;
  if (claim.evidenceRisk === "HIGH" || claim.claimType === "CAUSAL" || claim.claimType === "AUTHENTICITY") {
    return true;
  }
  return !support.some(
    (item) => item.authoritativePrimary && item.provenanceConfidence === "HIGH",
  );
}

export function buildFalsificationRequest(
  claim: CompiledClaim,
  serialRound: number,
): ResearchRequest {
  return {
    id: stableTruthUuid(`${claim.runId}:${claim.id}:disconfirm:${serialRound}`),
    runId: claim.runId,
    claimId: claim.id,
    parentQuestionId: null,
    purpose: "DISCONFIRM",
    query: `Find the strongest evidence that would make the opposite of this claim credible: ${claim.text}`,
    serialRound,
  };
}

export function buildContradictionVerificationRequest(
  claim: CompiledClaim,
  parentQuestionId: string,
  serialRound: number,
): ResearchRequest {
  return {
    id: stableTruthUuid(`${claim.runId}:${claim.id}:verify-contradiction:${serialRound}`),
    runId: claim.runId,
    claimId: claim.id,
    parentQuestionId,
    purpose: "CONTRADICTION_VERIFY",
    query: `Verify provenance, context, temporal applicability, and claim relation for blocking counterevidence to: ${claim.text}`,
    serialRound,
  };
}

export function verifiedBlockingContradictions(evidence: ClaimEvidence[]): ClaimEvidence[] {
  return evidence.filter(
    (item) =>
      item.relation === "CONTRADICTS"
      && item.admitted
      && item.verification === "VERIFIED",
  );
}

export interface FalsificationResult {
  evidence: ClaimEvidence[];
  research: TruthResearchResult[];
  requests: ResearchRequest[];
  verifiedContradictions: ClaimEvidence[];
  serialRounds: number;
}

export async function runSelectiveFalsification(
  claim: CompiledClaim,
  evidence: ClaimEvidence[],
  provider: TruthResearchProvider,
  startRound = 1,
): Promise<FalsificationResult> {
  if (!shouldRouteFalsification(claim, evidence)) {
    return { evidence: [...evidence], research: [], requests: [], verifiedContradictions: [], serialRounds: 0 };
  }

  const disconfirm = buildFalsificationRequest(claim, startRound);
  const first = await researchWithAdmission(provider, disconfirm);
  let merged = mergeClaimEvidenceStrict([evidence, first.evidence], { allowDispositionUpdates: true });
  const requests = [disconfirm];
  const research = [first];
  let serialRounds = 1;

  const unresolvedContradictions = merged.filter(
    (item) => item.relation === "CONTRADICTS" && item.admitted && item.verification === "UNVERIFIED",
  );
  if (unresolvedContradictions.length > 0) {
    const verify = buildContradictionVerificationRequest(claim, disconfirm.id, startRound + 1);
    const verified = await researchWithAdmission(provider, verify);
    merged = mergeClaimEvidenceStrict([merged, verified.evidence], { allowDispositionUpdates: true });
    requests.push(verify);
    research.push(verified);
    serialRounds += 1;
  }

  return {
    evidence: merged,
    research,
    requests,
    verifiedContradictions: verifiedBlockingContradictions(merged),
    serialRounds,
  };
}
