import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProvenanceState } from "../src/truth/provenance.js";
import { mergeClaimEvidenceStrict } from "../src/truth/state-merge.js";
import type { ClaimEvidence, SourceArtifact, SourceEdge } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000836";

function evidence(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return {
    id: "claim-evidence-1",
    runId,
    claimId: "claim-1",
    artifactId: "artifact-1",
    externalEvidenceId: "external-1",
    relation: "CONTRADICTS",
    specificEvidence: "same immutable observation",
    provenanceComponentKey: "origin-a",
    provenanceConfidence: "HIGH",
    authoritativePrimary: false,
    researchQuestionId: "research-1",
    verification: "UNVERIFIED",
    admitted: true,
    rejectionReason: null,
    ...overrides,
  };
}

function artifact(id: string, component: string, originKey: string): SourceArtifact {
  return {
    id,
    runId,
    canonicalUri: `fixture://${id}`,
    artifactHash: `hash-${id}`,
    publisher: "fixture",
    originKey,
    provenanceComponentKey: component,
    provenanceConfidence: "HIGH",
    authoritativePrimary: false,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    contentType: "text/plain",
    metadata: {},
    untrusted: true,
  };
}

test("canonical V36 evidence merge permits only disposition updates for the same observation", () => {
  const initial = evidence();
  const verified = evidence({
    id: "claim-evidence-verify",
    researchQuestionId: "research-verify",
    verification: "VERIFIED",
  });

  const merged = mergeClaimEvidenceStrict([[initial], [verified]], { allowDispositionUpdates: true });
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.verification, "VERIFIED");
  assert.equal(merged[0]?.researchQuestionId, "research-verify");

  assert.throws(
    () => mergeClaimEvidenceStrict(
      [[initial], [verified]],
      { allowDispositionUpdates: false },
    ),
    /Conflicting V36 claim evidence identity/,
  );
});

test("canonical V36 evidence merge rejects reused identity with changed observation content", () => {
  const initial = evidence();
  const contaminated = evidence({
    id: "claim-evidence-contaminated",
    specificEvidence: "different observation smuggled under the same identity",
    verification: "VERIFIED",
  });

  assert.throws(
    () => mergeClaimEvidenceStrict([[initial], [contaminated]], { allowDispositionUpdates: true }),
    /Conflicting V36 claim evidence identity/,
  );
});

test("research cannot newly claim a material decision evidence identity", () => {
  assert.throws(
    () => mergeClaimEvidenceStrict(
      [[], [evidence()]],
      { reservedExternalEvidenceIds: new Set(["external-1"]) },
    ),
    /collides with existing material decision evidence/,
  );
});

test("canonical provenance normalization collapses copied sources and rewrites evidence consistently", () => {
  const derivative = artifact("derivative", "copy-chain", "copy-origin");
  const original = artifact("original", "original-chain", "original-origin");
  const edge: SourceEdge = {
    id: "edge-1",
    runId,
    fromArtifactId: derivative.id,
    toArtifactId: original.id,
    edgeType: "COPIES",
    confidence: 0.99,
    contentSimilarity: 0.99,
  };
  const links = [
    evidence({
      id: "copy-evidence",
      artifactId: derivative.id,
      externalEvidenceId: "copy-evidence",
      relation: "SUPPORTS",
      provenanceComponentKey: "copy-chain",
      authoritativePrimary: false,
      verification: "VERIFIED",
    }),
    evidence({
      id: "original-evidence",
      artifactId: original.id,
      externalEvidenceId: "original-evidence",
      relation: "SUPPORTS",
      provenanceComponentKey: "original-chain",
      authoritativePrimary: true,
      verification: "VERIFIED",
    }),
  ];

  const normalized = normalizeProvenanceState(
    runId,
    [derivative, original],
    [edge],
    links,
    {
      sourceAuthority: "DERIVE_FROM_EVIDENCE",
      trustedOriginSourceIds: new Set([derivative.id, original.id]),
    },
  );

  assert.equal(normalized.components.length, 1);
  assert.equal(new Set(normalized.sources.map((source) => source.provenanceComponentKey)).size, 1);
  assert.equal(new Set(normalized.evidence.map((item) => item.provenanceComponentKey)).size, 1);
  assert.equal(normalized.evidence.find((item) => item.artifactId === derivative.id)?.authoritativePrimary, false);
  assert.equal(normalized.evidence.find((item) => item.artifactId === original.id)?.authoritativePrimary, true);
  assert.equal(normalized.components[0]?.canonicalOriginKey, "original-origin");
});
