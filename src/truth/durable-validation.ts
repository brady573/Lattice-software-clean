import { isDeepStrictEqual } from "node:util";
import type { FixtureDataset } from "./fixture-dataset.js";
import { adjudicateClaim } from "./adjudication.js";
import {
  buildCorroborationRequest,
  corroborationState,
} from "./corroboration.js";
import {
  admitV36ResumeResults,
  createV36NeedsResearch,
  type V36AdmittedResearchResult,
  type V36NeedsResearch,
  type V36ResearchCheckpoint,
  type V36ResearchRequest,
  type V36UntrustedResearchExecutionResult,
} from "./continuation.js";
import {
  buildContradictionVerificationRequest,
  buildFalsificationRequest,
  shouldRouteFalsification,
} from "./falsification.js";
import type { ResearchEvidenceAdmissionPolicy } from "./pipeline.js";
import { normalizeProvenanceState } from "./provenance.js";
import { mergeClaimEvidenceStrict } from "./state-merge.js";
import {
  assertTruthSnapshotIntegrity,
  createTruthSnapshot,
  type TruthSnapshot,
} from "./snapshot.js";
import { stableTruthUuid } from "./ids.js";
import type {
  ClaimEvidence,
  CompiledClaim,
  ResearchQuestion,
  SourceArtifact,
  SourceEdge,
  TruthAssessment,
  TruthBundle,
} from "./types.js";

export interface DurableV36ValidatedState {
  kind: "VALIDATED";
  snapshot: TruthSnapshot;
  serialRounds: number;
}

export type DurableV36ValidationStep = V36NeedsResearch | DurableV36ValidatedState;

function sameValue(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function mergeResearchQuestions(base: ResearchQuestion[], additions: ResearchQuestion[]): ResearchQuestion[] {
  const result = new Map(base.map((item) => [item.id, structuredClone(item)]));
  for (const item of additions) {
    const existing = result.get(item.id);
    if (existing && !sameValue(existing, item)) {
      throw new Error(`Research question ${item.id} collided with different persisted state.`);
    }
    if (!existing) result.set(item.id, structuredClone(item));
  }
  return [...result.values()];
}

function canonicalizeSources(
  base: SourceArtifact[],
  additions: SourceArtifact[],
): { sources: SourceArtifact[]; artifactIdMap: Map<string, string> } {
  const byHash = new Map<string, SourceArtifact>();
  const hashById = new Map<string, string>();
  const artifactIdMap = new Map<string, string>();

  for (const source of [...base, ...additions]) {
    const knownHash = hashById.get(source.id);
    if (knownHash && knownHash !== source.artifactHash) {
      throw new Error(`Source artifact ${source.id} was reused for different content.`);
    }
    hashById.set(source.id, source.artifactHash);

    const canonical = byHash.get(source.artifactHash);
    if (canonical) {
      artifactIdMap.set(source.id, canonical.id);
      continue;
    }
    const copy = structuredClone(source);
    byHash.set(source.artifactHash, copy);
    artifactIdMap.set(source.id, copy.id);
  }

  return { sources: [...byHash.values()], artifactIdMap };
}

function remapEvidenceArtifactIds(
  evidence: ClaimEvidence[],
  artifactIdMap: ReadonlyMap<string, string>,
): ClaimEvidence[] {
  return evidence.map((item) => {
    const artifactId = artifactIdMap.get(item.artifactId);
    if (!artifactId) throw new Error(`Claim evidence ${item.id} references an unknown research artifact.`);
    return { ...structuredClone(item), artifactId };
  });
}

function mergeSourceEdges(
  base: SourceEdge[],
  additions: SourceEdge[],
  artifactIdMap: ReadonlyMap<string, string>,
): SourceEdge[] {
  const result = new Map<string, SourceEdge>();
  for (const edge of [...base, ...additions]) {
    const fromArtifactId = artifactIdMap.get(edge.fromArtifactId);
    const toArtifactId = artifactIdMap.get(edge.toArtifactId);
    if (!fromArtifactId || !toArtifactId) {
      throw new Error(`Source edge ${edge.id} references an unknown research artifact.`);
    }
    const remapped = { ...structuredClone(edge), fromArtifactId, toArtifactId };
    const existing = result.get(remapped.id);
    if (existing && !sameValue(existing, remapped)) {
      throw new Error(`Source edge ${edge.id} collided with different persisted state.`);
    }
    result.set(remapped.id, remapped);
  }
  return [...result.values()];
}

function reAdjudicate(
  dataset: FixtureDataset,
  bundle: TruthBundle,
  previousAssessments: TruthAssessment[],
): TruthAssessment[] {
  const previousByClaim = new Map(previousAssessments.map((item) => [item.claimId, item]));
  const obligationsById = new Map(bundle.obligations.map((item) => [item.id, item]));
  const materiallyMisleadingByClaim = new Map(
    dataset.truthClaims.map((profile) => [
      stableTruthUuid(`${bundle.runId}:claim:${profile.id}`),
      profile.materiallyMisleading === true,
    ]),
  );

  return bundle.claims.map((claim) => {
    const previous = previousByClaim.get(claim.id);
    if (!previous) throw new Error(`Truth assessment missing for claim ${claim.id}.`);
    return adjudicateClaim({
      assessmentId: previous.id,
      claim,
      obligations: bundle.obligations.filter((item) => item.claimId === claim.id),
      checks: bundle.checks.filter((item) => obligationsById.get(item.obligationId)?.claimId === claim.id),
      evidence: bundle.claimEvidence.filter((item) => item.claimId === claim.id),
      ...(materiallyMisleadingByClaim.get(claim.id) ? { materiallyMisleading: true } : {}),
    });
  });
}

function toResearchQuestion(request: V36ResearchRequest): ResearchQuestion {
  return {
    id: request.id,
    runId: request.runId,
    claimId: request.claimId,
    parentQuestionId: request.parentRequestId,
    purpose: request.purpose,
    query: request.query,
    serialRound: request.serialRound,
  };
}

function durableRequestIds(claim: CompiledClaim, maxCorroborationProbes: number): Set<string> {
  const ids = new Set<string>();
  ids.add(buildFalsificationRequest(claim, 1).id);
  ids.add(buildContradictionVerificationRequest(claim, buildFalsificationRequest(claim, 1).id, 2).id);
  for (let round = 1; round <= maxCorroborationProbes; round += 1) {
    ids.add(buildCorroborationRequest(claim, round).id);
  }
  return ids;
}

function nextRequests(
  snapshot: TruthSnapshot,
  maxCorroborationProbes: number,
): V36ResearchRequest[] {
  const questions = new Set(snapshot.bundle.researchQuestions.map((item) => item.id));
  const requests: V36ResearchRequest[] = [];

  for (const claim of snapshot.bundle.claims) {
    const evidence = snapshot.bundle.claimEvidence.filter((item) => item.claimId === claim.id);
    const disconfirm = buildFalsificationRequest(claim, 1);
    if (shouldRouteFalsification(claim, evidence) && !questions.has(disconfirm.id)) {
      requests.push({ ...disconfirm, parentRequestId: disconfirm.parentQuestionId });
    }

    const unresolvedContradiction = evidence.some(
      (item) => item.relation === "CONTRADICTS" && item.admitted && item.verification === "UNVERIFIED",
    );
    const verifyContradiction = buildContradictionVerificationRequest(claim, disconfirm.id, 2);
    if (unresolvedContradiction && questions.has(disconfirm.id) && !questions.has(verifyContradiction.id)) {
      requests.push({ ...verifyContradiction, parentRequestId: verifyContradiction.parentQuestionId });
    }

    let probesUsed = 0;
    for (let round = 1; round <= maxCorroborationProbes; round += 1) {
      if (questions.has(buildCorroborationRequest(claim, round).id)) probesUsed += 1;
    }
    const corroboration = corroborationState(claim, evidence, probesUsed, maxCorroborationProbes);
    if (!corroboration.complete) {
      const request = buildCorroborationRequest(claim, probesUsed + 1);
      if (!questions.has(request.id)) {
        requests.push({ ...request, parentRequestId: request.parentQuestionId });
      }
    }
  }

  return requests;
}

function continuationRound(snapshot: TruthSnapshot, maxCorroborationProbes: number): number {
  const durableIds = new Set<string>();
  for (const claim of snapshot.bundle.claims) {
    for (const id of durableRequestIds(claim, maxCorroborationProbes)) durableIds.add(id);
  }
  const executed = snapshot.bundle.researchQuestions.filter((item) => durableIds.has(item.id)).length;
  return executed + 1;
}

function serialRounds(snapshot: TruthSnapshot): number {
  return Math.max(1, ...snapshot.bundle.researchQuestions.map((item) => item.serialRound));
}

export function beginDurableV36Validation(
  snapshot: TruthSnapshot,
  maxCorroborationProbes = 2,
): DurableV36ValidationStep {
  assertTruthSnapshotIntegrity(snapshot);
  if (snapshot.phase !== "INVESTIGATED") {
    throw new Error("Durable V36 validation requires an INVESTIGATED truth snapshot.");
  }
  const requests = nextRequests(snapshot, maxCorroborationProbes);
  if (requests.length > 0) {
    return createV36NeedsResearch(snapshot, requests, continuationRound(snapshot, maxCorroborationProbes));
  }
  return {
    kind: "VALIDATED",
    snapshot: createTruthSnapshot("VALIDATED", snapshot.executionContractId, snapshot.bundle),
    serialRounds: serialRounds(snapshot),
  };
}

function applyAdmittedResults(
  dataset: FixtureDataset,
  checkpoint: V36ResearchCheckpoint,
  results: readonly V36AdmittedResearchResult[],
): TruthSnapshot {
  const bundle = structuredClone(checkpoint.snapshot.bundle);
  const previousAssessments = structuredClone(bundle.assessments);
  const successful = results.filter(
    (item): item is Extract<V36AdmittedResearchResult, { outcome: "SUCCEEDED" }> => item.outcome === "SUCCEEDED",
  );

  const sourceState = canonicalizeSources(
    bundle.sources,
    successful.flatMap((item) => item.truthResult.artifacts),
  );
  const trustedBaseSourceIds = new Set(bundle.sources.map((source) => source.id));
  const mergedEvidence = mergeClaimEvidenceStrict(
    [bundle.claimEvidence, ...successful.map((item) => item.truthResult.evidence)],
    { allowDispositionUpdates: true },
  );
  const remappedEvidence = remapEvidenceArtifactIds(mergedEvidence, sourceState.artifactIdMap);
  const mergedEdges = mergeSourceEdges(
    bundle.sourceEdges,
    successful.flatMap((item) => item.truthResult.edges),
    sourceState.artifactIdMap,
  );
  const normalized = normalizeProvenanceState(
    bundle.runId,
    sourceState.sources,
    mergedEdges,
    remappedEvidence,
    {
      sourceAuthority: "DERIVE_FROM_EVIDENCE",
      trustedOriginSourceIds: trustedBaseSourceIds,
    },
  );

  const enriched: TruthBundle = {
    ...bundle,
    provenanceComponents: normalized.components,
    researchQuestions: mergeResearchQuestions(
      bundle.researchQuestions,
      checkpoint.researchRequests.map(toResearchQuestion),
    ),
    sources: normalized.sources,
    sourceEdges: mergedEdges,
    claimEvidence: normalized.evidence,
  };
  enriched.assessments = reAdjudicate(dataset, enriched, previousAssessments);
  return createTruthSnapshot("INVESTIGATED", checkpoint.executionContractId, enriched);
}

export function resumeDurableV36Validation(
  dataset: FixtureDataset,
  checkpoint: V36ResearchCheckpoint,
  results: readonly V36UntrustedResearchExecutionResult[],
  admissionPolicy: ResearchEvidenceAdmissionPolicy,
  maxCorroborationProbes = 2,
): DurableV36ValidationStep {
  const admitted = admitV36ResumeResults(checkpoint, results, admissionPolicy);
  const resumedSnapshot = applyAdmittedResults(dataset, admitted.checkpoint, admitted.results);
  return beginDurableV36Validation(resumedSnapshot, maxCorroborationProbes);
}
