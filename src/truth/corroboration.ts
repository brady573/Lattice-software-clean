import { stableTruthUuid } from "./ids.js";
import { evaluatePositiveBurden } from "./positive-burden.js";
import type { ClaimEvidence, CompiledClaim } from "./types.js";
import {
  researchWithAdmission,
  type ResearchRequest,
  type TruthResearchProvider,
  type TruthResearchResult,
} from "./pipeline.js";
import { mergeClaimEvidenceStrict } from "./state-merge.js";

export interface CorroborationState {
  complete: boolean;
  reason: "SATISFIED" | "VERIFIED_CONTRADICTION" | "NEEDS_SECOND_ORIGIN" | "BUDGET_EXHAUSTED";
}

export function corroborationState(
  claim: CompiledClaim,
  evidence: ClaimEvidence[],
  probesUsed: number,
  maxProbes: number,
): CorroborationState {
  const contradiction = evidence.some(
    (item) => item.relation === "CONTRADICTS" && item.admitted && item.verification === "VERIFIED",
  );
  if (contradiction) return { complete: true, reason: "VERIFIED_CONTRADICTION" };

  const burden = evaluatePositiveBurden(claim, evidence);
  if (burden.satisfied) return { complete: true, reason: "SATISFIED" };
  if (probesUsed >= maxProbes) return { complete: true, reason: "BUDGET_EXHAUSTED" };
  return { complete: false, reason: "NEEDS_SECOND_ORIGIN" };
}

export function buildCorroborationRequest(
  claim: CompiledClaim,
  serialRound: number,
): ResearchRequest {
  return {
    id: stableTruthUuid(`${claim.runId}:${claim.id}:corroborate:${serialRound}`),
    runId: claim.runId,
    claimId: claim.id,
    parentQuestionId: null,
    purpose: "INDEPENDENT_CORROBORATION",
    query: `Find a materially independent original evidence chain for: ${claim.text}`,
    serialRound,
  };
}

export interface CorroborationRecoveryResult {
  state: CorroborationState;
  evidence: ClaimEvidence[];
  requests: ResearchRequest[];
  research: TruthResearchResult[];
  probesUsed: number;
  serialRounds: number;
}

export async function recoverIndependentCorroboration(
  claim: CompiledClaim,
  evidence: ClaimEvidence[],
  provider: TruthResearchProvider,
  maxProbes: number,
  startRound = 1,
): Promise<CorroborationRecoveryResult> {
  let merged = [...evidence];
  const requests: ResearchRequest[] = [];
  const research: TruthResearchResult[] = [];
  let probesUsed = 0;
  let state = corroborationState(claim, merged, probesUsed, maxProbes);

  while (!state.complete) {
    const request = buildCorroborationRequest(claim, startRound + probesUsed);
    const result = await researchWithAdmission(provider, request);
    requests.push(request);
    research.push(result);
    probesUsed += 1;
    merged = mergeClaimEvidenceStrict([merged, result.evidence], { allowDispositionUpdates: true });
    state = corroborationState(claim, merged, probesUsed, maxProbes);
  }

  return {
    state,
    evidence: merged,
    requests,
    research,
    probesUsed,
    serialRounds: probesUsed,
  };
}
