import { createHash } from "node:crypto";
import type { Evidence } from "../domain.js";
import type { FixtureDataset } from "../fixtures.js";
import { adjudicateClaim } from "./adjudication.js";
import { materializeDecisionEvidence, type AdmittedDecisionEvidence } from "./admission.js";
import { compileClaim } from "./claim-compiler.js";
import {
  conservativeProvenanceConfidence,
  dedupeArtifactsByHash,
  normalizeProvenanceState,
  recoverOriginalArtifact,
} from "./provenance.js";
import { stableTruthUuid } from "./ids.js";
import type {
  ClaimEvidence,
  CompiledClaim,
  ProofCheck,
  ProofObligation,
  ResearchQuestion,
  SourceArtifact,
  SourceEdge,
  TruthAssessment,
  TruthBundle,
  TruthEvidenceProfile,
} from "./types.js";

function sourceArtifact(
  runId: string,
  evidence: Evidence,
  profiles: TruthEvidenceProfile[],
): SourceArtifact {
  const componentKeys = [...new Set(
    profiles.map((profile) => profile.provenanceComponentKey).filter(Boolean),
  )];
  if (componentKeys.length > 1) {
    throw new Error(`Source ${evidence.sourceId} is assigned to conflicting provenance components.`);
  }
  const artifactHash = createHash("sha256")
    .update(`${evidence.sourceId}\u0000${evidence.sourceLabel}`)
    .digest("hex");
  return {
    id: stableTruthUuid(`${runId}:source:${evidence.sourceId}`),
    runId,
    canonicalUri: `fixture://${encodeURIComponent(evidence.sourceId)}`,
    artifactHash,
    publisher: "Lattice deterministic fixture",
    originKey: evidence.sourceId,
    provenanceComponentKey: componentKeys[0] ?? null,
    provenanceConfidence: conservativeProvenanceConfidence(
      profiles.map((profile) => profile.provenanceConfidence),
    ),
    authoritativePrimary: profiles.some((profile) => profile.authoritativePrimary),
    retrievedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    contentType: "application/x-lattice-fixture",
    metadata: { sourceLabel: evidence.sourceLabel },
    untrusted: true,
  };
}

export interface FixtureTruthEvaluation {
  bundle: TruthBundle;
  decisionEvidence: AdmittedDecisionEvidence[];
  assessments: TruthAssessment[];
  serialRounds: number;
}

export function evaluateFixtureTruth(runId: string, dataset: FixtureDataset): FixtureTruthEvaluation {
  const evidenceById = new Map(dataset.evidence.map((evidence) => [evidence.id, evidence]));
  const evidenceProfileById = new Map(dataset.truthEvidence.map((profile) => [profile.evidenceId, profile]));
  const claimProfilesById = new Map(dataset.truthClaims.map((profile) => [profile.id, profile]));
  if (claimProfilesById.size !== dataset.truthClaims.length) {
    throw new Error("Truth claim profile IDs must be unique.");
  }
  if (evidenceProfileById.size !== dataset.truthEvidence.length) {
    throw new Error("Truth evidence profile IDs must be unique.");
  }

  const compiledByProfileId = new Map<string, CompiledClaim>();
  const requiredProofKindsByProfileId = new Map<string, readonly string[]>();
  const claims = dataset.truthClaims.map((profile) => {
    const compilation = compileClaim({
      runId,
      sourceClaimId: profile.id,
      text: profile.text,
      claimType: profile.claimType,
      scope: profile.scope ?? profile.candidateId,
      effectiveAt: profile.effectiveAt ?? null,
      jurisdiction: profile.jurisdiction ?? null,
      unit: profile.unit ?? null,
      denominator: profile.denominator ?? null,
      baseline: profile.baseline ?? null,
      period: profile.period ?? null,
      causalRelation: profile.causalRelation ?? null,
      authenticityTarget: profile.authenticityTarget ?? null,
      comparisonClass: profile.comparisonClass ?? null,
      quotedContext: profile.quotedContext ?? null,
      qualifiers: profile.qualifiers ?? [],
      evidenceRisk: profile.evidenceRisk ?? "ORDINARY",
    });
    compiledByProfileId.set(profile.id, compilation.claim);
    requiredProofKindsByProfileId.set(profile.id, compilation.requiredProofKinds);
    return compilation.claim;
  });

  const referencedEvidenceIds = new Set(dataset.truthClaims.flatMap((profile) => profile.evidenceIds));
  for (const evidenceId of referencedEvidenceIds) {
    if (!evidenceById.has(evidenceId)) {
      throw new Error(`Truth claim references unknown evidence ${evidenceId}.`);
    }
    const profile = evidenceProfileById.get(evidenceId);
    if (!profile) throw new Error(`Evidence ${evidenceId} has no V36 evidence profile.`);
    if (!claimProfilesById.has(profile.claimId)) {
      throw new Error(`Evidence ${evidenceId} references unknown claim ${profile.claimId}.`);
    }
  }

  const sourcesBySourceId = new Map<string, SourceArtifact>();
  for (const evidence of dataset.evidence) {
    const profile = evidenceProfileById.get(evidence.id);
    if (!profile || sourcesBySourceId.has(evidence.sourceId)) continue;
    const sameSourceProfiles = dataset.evidence
      .filter((item) => item.sourceId === evidence.sourceId)
      .flatMap((item) => {
        const match = evidenceProfileById.get(item.id);
        return match ? [match] : [];
      });
    sourcesBySourceId.set(evidence.sourceId, sourceArtifact(runId, evidence, sameSourceProfiles));
  }

  const sources = dedupeArtifactsByHash([...sourcesBySourceId.values()]);
  let sourceBySourceId = new Map<string, SourceArtifact>();
  for (const evidence of dataset.evidence) {
    const source = sources.find(
      (candidate) => candidate.canonicalUri === `fixture://${encodeURIComponent(evidence.sourceId)}`,
    );
    if (source) sourceBySourceId.set(evidence.sourceId, source);
  }

  const researchQuestionIdByProfile = new Map<string, string>();
  const researchQuestions: ResearchQuestion[] = (dataset.truthResearch ?? []).map((profile) => {
    const compiled = compiledByProfileId.get(profile.claimId);
    if (!compiled) {
      throw new Error(`Research question ${profile.id} references unknown claim ${profile.claimId}.`);
    }
    const id = stableTruthUuid(`${runId}:research:${profile.id}`);
    researchQuestionIdByProfile.set(profile.id, id);
    return {
      id,
      runId,
      claimId: compiled.id,
      parentQuestionId: null,
      purpose: profile.purpose,
      query: profile.query,
      serialRound: profile.serialRound,
    };
  });
  for (const profile of dataset.truthResearch ?? []) {
    if (!profile.parentQuestionId) continue;
    const question = researchQuestions.find(
      (item) => item.id === researchQuestionIdByProfile.get(profile.id),
    );
    const parent = researchQuestionIdByProfile.get(profile.parentQuestionId);
    if (!question || !parent) {
      throw new Error(`Research question ${profile.id} has an unknown parent.`);
    }
    question.parentQuestionId = parent;
  }

  const sourceEdges: SourceEdge[] = (dataset.truthSourceEdges ?? []).map((edge, index) => {
    const from = sourceBySourceId.get(edge.fromSourceId);
    const to = sourceBySourceId.get(edge.toSourceId);
    if (!from || !to) throw new Error("Fixture source edge references an unknown source artifact.");
    return {
      id: stableTruthUuid(`${runId}:source-edge:${index}:${from.id}:${to.id}:${edge.edgeType}`),
      runId,
      fromArtifactId: from.id,
      toArtifactId: to.id,
      edgeType: edge.edgeType,
      confidence: edge.confidence,
      contentSimilarity: edge.contentSimilarity ?? null,
    };
  });

  const provenance = normalizeProvenanceState(
    runId,
    sources,
    sourceEdges,
    [],
    {
      sourceAuthority: "PRESERVE_TRUTH_LAYER_SOURCE",
      trustedOriginSourceIds: new Set(sources.map((source) => source.id)),
    },
  );
  const normalizedSources = provenance.sources;
  const provenanceComponents = provenance.components;
  const normalizedSourceById = new Map(normalizedSources.map((source) => [source.id, source]));
  sourceBySourceId = new Map<string, SourceArtifact>();
  for (const evidence of dataset.evidence) {
    const original = sources.find(
      (candidate) => candidate.canonicalUri === `fixture://${encodeURIComponent(evidence.sourceId)}`,
    );
    const normalized = original ? normalizedSourceById.get(original.id) : undefined;
    if (normalized) sourceBySourceId.set(evidence.sourceId, normalized);
  }

  const componentConfidence = new Map(
    provenanceComponents.map((component) => [component.key, component.confidence]),
  );

  const claimEvidence: ClaimEvidence[] = [];
  const obligations: ProofObligation[] = [];
  const checks: ProofCheck[] = [];
  const assessments: TruthAssessment[] = [];

  for (const profile of dataset.truthClaims) {
    const compiled = compiledByProfileId.get(profile.id);
    if (!compiled) throw new Error(`Compiled claim missing for ${profile.id}.`);
    const requiredProofKinds = requiredProofKindsByProfileId.get(profile.id);
    if (!requiredProofKinds) throw new Error(`Compiled proof contract missing for ${profile.id}.`);
    const requiredKinds = new Set(requiredProofKinds);
    const allKinds = [...new Set([...requiredKinds, ...Object.keys(profile.checks)])];
    const claimObligations = allKinds.map<ProofObligation>((kind) => ({
      id: stableTruthUuid(`${runId}:obligation:${profile.id}:${kind}`),
      runId,
      claimId: compiled.id,
      kind,
      required: requiredKinds.has(kind),
    }));
    obligations.push(...claimObligations);

    const claimChecks = claimObligations.map<ProofCheck>((obligation) => {
      const status = profile.checks[obligation.kind] ?? "UNRESOLVED";
      return {
        id: stableTruthUuid(`${runId}:check:${profile.id}:${obligation.kind}`),
        runId,
        obligationId: obligation.id,
        kind: obligation.kind,
        status,
        evidenceIds: status === "PASSED" ? [...profile.evidenceIds] : [],
        explanation: status === "PASSED"
          ? "Deterministic prototype proof passed."
          : "Deterministic prototype proof did not pass.",
      };
    });
    checks.push(...claimChecks);

    const links = profile.evidenceIds.map<ClaimEvidence>((externalEvidenceId) => {
      const evidence = evidenceById.get(externalEvidenceId);
      const evidenceProfile = evidenceProfileById.get(externalEvidenceId);
      if (!evidence || !evidenceProfile) {
        throw new Error(`Missing evidence profile for ${externalEvidenceId}.`);
      }
      if (evidenceProfile.claimId !== profile.id) {
        throw new Error(
          `Evidence ${externalEvidenceId} is bound to ${evidenceProfile.claimId}, not ${profile.id}.`,
        );
      }
      const source = sourceBySourceId.get(evidence.sourceId);
      if (!source) throw new Error(`Missing source artifact for ${evidence.sourceId}.`);
      const sourceAccepted = evidenceProfile.sourceAccepted && evidenceProfile.verification !== "REJECTED";
      const normalizedComponent = source.provenanceComponentKey;
      const original = recoverOriginalArtifact(source.id, normalizedSources, sourceEdges);
      const isRecoveredOriginal = original?.id === source.id;
      return {
        id: stableTruthUuid(`${runId}:claim-evidence:${profile.id}:${externalEvidenceId}`),
        runId,
        claimId: compiled.id,
        artifactId: source.id,
        externalEvidenceId,
        relation: evidenceProfile.relation,
        specificEvidence: `${evidence.sourceLabel}: ${String(evidence.value)}`,
        provenanceComponentKey: normalizedComponent,
        provenanceConfidence: normalizedComponent
          ? componentConfidence.get(normalizedComponent) ?? "UNKNOWN"
          : "UNKNOWN",
        authoritativePrimary: evidenceProfile.authoritativePrimary && isRecoveredOriginal,
        researchQuestionId: evidenceProfile.researchQuestionId
          ? researchQuestionIdByProfile.get(evidenceProfile.researchQuestionId) ?? null
          : null,
        verification: evidenceProfile.verification,
        admitted: sourceAccepted,
        rejectionReason: sourceAccepted
          ? null
          : "Source/provenance admission or evidence verification failed.",
      };
    });
    claimEvidence.push(...links);

    const assessment = adjudicateClaim({
      assessmentId: stableTruthUuid(`${runId}:assessment:${profile.id}`),
      claim: compiled,
      obligations: claimObligations,
      checks: claimChecks,
      evidence: links,
      ...(profile.materiallyMisleading !== undefined
        ? { materiallyMisleading: profile.materiallyMisleading }
        : {}),
    });
    assessments.push(assessment);
  }

  const decisionEvidence = materializeDecisionEvidence(dataset.evidence, claimEvidence, assessments);
  const serialRounds = Math.max(1, ...researchQuestions.map((question) => question.serialRound));

  return {
    bundle: {
      runId,
      provenanceComponents,
      researchQuestions,
      sources: normalizedSources,
      sourceEdges,
      claims,
      claimEvidence,
      obligations,
      checks,
      assessments,
    },
    decisionEvidence,
    assessments,
    serialRounds,
  };
}
