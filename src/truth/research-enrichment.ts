import { isDeepStrictEqual } from "node:util";
import type { FixtureDataset } from "../fixtures.js";
import { adjudicateClaim } from "./adjudication.js";
import { assertTruthBundleIntegrity } from "./invariants.js";
import type { TruthResearchProvider } from "./pipeline.js";
import { normalizeProvenanceState } from "./provenance.js";
import { runPrototypeResearch } from "./research-controller.js";
import { stableTruthUuid } from "./ids.js";
import { mergeClaimEvidenceStrict } from "./state-merge.js";
import type {
  ClaimEvidence,
  ResearchQuestion,
  SourceArtifact,
  SourceEdge,
  TruthAssessment,
  TruthBundle,
} from "./types.js";

function sameValue(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function mergeResearchQuestions(
  base: ResearchQuestion[],
  additions: ResearchQuestion[],
): ResearchQuestion[] {
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

export interface ResearchEnrichmentResult {
  bundle: TruthBundle;
  serialCriticalPathRounds: number;
}

/**
 * Apply bounded provider-neutral research to an already compiled V36 truth
 * bundle. The provider can add observations; only truth-layer admission and
 * the canonical V36 provenance normalizer can change authoritative state.
 */
export async function enrichTruthBundleWithResearch(
  dataset: FixtureDataset,
  inputBundle: TruthBundle,
  provider: TruthResearchProvider,
  maxCorroborationProbes = 2,
): Promise<ResearchEnrichmentResult> {
  const bundle = structuredClone(inputBundle);
  assertTruthBundleIntegrity(bundle);
  const previousAssessments = structuredClone(bundle.assessments);

  const research = await Promise.all(bundle.claims.map(async (claim) => {
    const initialEvidence = bundle.claimEvidence.filter((item) => item.claimId === claim.id);
    const result = await runPrototypeResearch(claim, initialEvidence, provider, maxCorroborationProbes);
    return { claimId: claim.id, result };
  }));

  const materialEvidenceIds = new Set(dataset.evidence.map((item) => item.id));
  const mergedEvidence = mergeClaimEvidenceStrict(
    [bundle.claimEvidence, ...research.map((item) => item.result.evidence)],
    { reservedExternalEvidenceIds: materialEvidenceIds },
  );
  const researchSources = research.flatMap((item) => item.result.artifacts);
  const trustedBaseSourceIds = new Set(bundle.sources.map((source) => source.id));
  const sourceState = canonicalizeSources(bundle.sources, researchSources);
  const remappedEvidence = remapEvidenceArtifactIds(mergedEvidence, sourceState.artifactIdMap);
  const mergedEdges = mergeSourceEdges(
    bundle.sourceEdges,
    research.flatMap((item) => item.result.edges),
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
      research.flatMap((item) => item.result.researchQuestions),
    ),
    sources: normalized.sources,
    sourceEdges: mergedEdges,
    claimEvidence: normalized.evidence,
  };
  enriched.assessments = reAdjudicate(dataset, enriched, previousAssessments);
  assertTruthBundleIntegrity(enriched);

  return {
    bundle: enriched,
    serialCriticalPathRounds: Math.max(
      0,
      ...research.map((item) => item.result.serialCriticalPathRounds),
    ),
  };
}
