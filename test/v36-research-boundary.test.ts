import assert from "node:assert/strict";
import test from "node:test";
import {
  OfflineFixtureResearchAdmissionPolicy,
  OfflineFixtureResearchProvider,
  researchWithAdmission,
  validateResearchResult,
  type ResearchEvidenceCandidate,
  type ResearchRequest,
  type ResearchResult,
  type TruthResearchProvider,
} from "../src/truth/pipeline.js";

const runId = "00000000-0000-4000-8000-000000003036";
const claimId = "claim-research-boundary";
const request: ResearchRequest = {
  id: "00000000-0000-4000-8000-000000003037",
  runId,
  claimId,
  parentQuestionId: null,
  purpose: "SUPPORT",
  query: "Find evidence for the claim.",
  serialRound: 1,
};

const candidate: ResearchEvidenceCandidate = {
  artifactId: "artifact-provider",
  externalEvidenceId: "provider-evidence",
  relation: "SUPPORTS",
  specificEvidence: "Provider observation only.",
};

test("generic provider cannot manufacture V36 authority fields", async () => {
  const maliciousCandidate = {
    ...candidate,
    runId,
    claimId,
    admitted: true,
    verification: "VERIFIED",
    provenanceComponentKey: "fabricated-independent-origin",
    provenanceConfidence: "HIGH",
    authoritativePrimary: true,
    rejectionReason: null,
  } as ResearchEvidenceCandidate;

  const provider: TruthResearchProvider = {
    mode: "offline-fixture",
    async research(): Promise<ResearchResult> {
      return { artifacts: [], edges: [], evidence: [maliciousCandidate] };
    },
  };

  const result = await researchWithAdmission(provider, request);
  assert.equal(result.evidence.length, 1);
  const evidence = result.evidence[0];
  assert.ok(evidence);
  assert.equal(evidence.runId, runId);
  assert.equal(evidence.claimId, claimId);
  assert.equal(evidence.researchQuestionId, request.id);
  assert.equal(evidence.admitted, false);
  assert.equal(evidence.verification, "UNVERIFIED");
  assert.equal(evidence.provenanceComponentKey, null);
  assert.equal(evidence.provenanceConfidence, "UNKNOWN");
  assert.equal(evidence.authoritativePrimary, false);
  assert.match(evidence.rejectionReason ?? "", /has not passed V36 truth-layer admission/);
});

test("offline provider returns observation fields only even when legacy fixture input contains authority", async () => {
  const legacyCandidate = {
    ...candidate,
    runId,
    claimId,
    admitted: true,
    verification: "VERIFIED",
    provenanceComponentKey: "fixture-origin",
    provenanceConfidence: "HIGH",
    authoritativePrimary: true,
    rejectionReason: null,
  } as ResearchEvidenceCandidate;
  const provider = new OfflineFixtureResearchProvider({
    [request.id]: { artifacts: [], edges: [], evidence: [legacyCandidate] },
  });

  const raw = await provider.research(request);
  const observation = raw.evidence[0] as ResearchEvidenceCandidate & Record<string, unknown>;
  assert.ok(observation);
  assert.deepEqual(Object.keys(observation).sort(), [
    "artifactId",
    "externalEvidenceId",
    "relation",
    "specificEvidence",
  ]);
  assert.equal("admitted" in observation, false);
  assert.equal("verification" in observation, false);
  assert.equal("provenanceComponentKey" in observation, false);
  assert.equal("authoritativePrimary" in observation, false);
});

test("explicit truth-layer fixture admission policy can authorize deterministic research evidence", async () => {
  const provider = new OfflineFixtureResearchProvider(
    { [request.id]: { artifacts: [], edges: [], evidence: [candidate] } },
    new OfflineFixtureResearchAdmissionPolicy({
      [request.id]: {
        [candidate.externalEvidenceId]: {
          verification: "VERIFIED",
          admitted: true,
          rejectionReason: null,
          provenanceComponentKey: "fixture-origin",
          provenanceConfidence: "HIGH",
          authoritativePrimary: true,
        },
      },
    }),
  );

  const result = await researchWithAdmission(provider, request);
  const evidence = result.evidence[0];
  assert.ok(evidence);
  assert.equal(evidence.admitted, true);
  assert.equal(evidence.verification, "VERIFIED");
  assert.equal(evidence.provenanceComponentKey, "fixture-origin");
  assert.equal(evidence.provenanceConfidence, "HIGH");
  assert.equal(evidence.authoritativePrimary, true);
  assert.equal(evidence.researchQuestionId, request.id);
});


function validArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "artifact-structural",
    runId,
    canonicalUri: "fixture://artifact-structural",
    artifactHash: "hash-artifact-structural",
    publisher: "Fixture publisher",
    originKey: "fixture-origin",
    provenanceComponentKey: null,
    provenanceConfidence: "MODERATE",
    authoritativePrimary: false,
    retrievedAt: "2026-09-20T00:00:00.000Z",
    publishedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    contentType: "text/plain",
    metadata: { nested: { preserved: true } },
    untrusted: true,
    ...overrides,
  };
}

function validEdge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "edge-structural",
    runId,
    fromArtifactId: "artifact-structural",
    toArtifactId: "artifact-other",
    edgeType: "CITES",
    confidence: 0.75,
    contentSimilarity: null,
    ...overrides,
  };
}

test("validateResearchResult structurally establishes SourceArtifact fields before construction", () => {
  const artifact = validArtifact();
  const validated = validateResearchResult(request, {
    artifacts: [artifact],
    edges: [],
    evidence: [],
  });
  assert.deepEqual(validated.artifacts, [artifact]);

  const malformed: Array<(value: Record<string, unknown>) => void> = [
    (value) => { delete value.id; },
    (value) => { value.canonicalUri = 42; },
    (value) => { value.publisher = 42; },
    (value) => { value.provenanceConfidence = "CERTAIN"; },
    (value) => { value.authoritativePrimary = "false"; },
    (value) => { value.untrusted = false; },
    (value) => { delete value.untrusted; },
    (value) => { value.metadata = null; },
    (value) => { value.metadata = []; },
    (value) => { value.runId = "different-run"; },
  ];

  for (const mutate of malformed) {
    const value = validArtifact();
    mutate(value);
    assert.throws(() => validateResearchResult(request, {
      artifacts: [value],
      edges: [],
      evidence: [],
    }));
  }
});

test("validateResearchResult structurally establishes SourceEdge fields before construction", () => {
  const edge = validEdge();
  const validated = validateResearchResult(request, {
    artifacts: [],
    edges: [edge],
    evidence: [],
  });
  assert.deepEqual(validated.edges, [edge]);

  const malformed: Array<(value: Record<string, unknown>) => void> = [
    (value) => { delete value.id; },
    (value) => { value.fromArtifactId = false; },
    (value) => { value.edgeType = "LINKS"; },
    (value) => { value.confidence = "0.75"; },
    (value) => { value.confidence = Number.NaN; },
    (value) => { value.confidence = Number.POSITIVE_INFINITY; },
    (value) => { value.contentSimilarity = "0.5"; },
    (value) => { value.contentSimilarity = Number.NEGATIVE_INFINITY; },
    (value) => { value.runId = "different-run"; },
  ];

  for (const mutate of malformed) {
    const value = validEdge();
    mutate(value);
    assert.throws(() => validateResearchResult(request, {
      artifacts: [],
      edges: [value],
      evidence: [],
    }));
  }
});

test("validateResearchResult establishes observation-only evidence and rejects invalid candidate structure", () => {
  const authorityShaped = {
    artifactId: "artifact-provider",
    externalEvidenceId: "provider-evidence-direct",
    relation: "CONTRADICTS",
    specificEvidence: "Provider observation only.",
    admitted: true,
    verification: "VERIFIED",
    provenanceComponentKey: "fabricated-origin",
    provenanceConfidence: "HIGH",
    authoritativePrimary: true,
    rejectionReason: null,
  };
  const validated = validateResearchResult(request, {
    artifacts: [],
    edges: [],
    evidence: [authorityShaped],
  });
  const observation = validated.evidence[0] as ResearchEvidenceCandidate & Record<string, unknown>;
  assert.ok(observation);
  assert.deepEqual(Object.keys(observation).sort(), [
    "artifactId",
    "externalEvidenceId",
    "relation",
    "specificEvidence",
  ]);
  assert.equal("admitted" in observation, false);
  assert.equal("verification" in observation, false);
  assert.equal("authoritativePrimary" in observation, false);

  const malformed = [
    { ...candidate, artifactId: 42 },
    { ...candidate, artifactId: " " },
    { ...candidate, externalEvidenceId: "" },
    { ...candidate, specificEvidence: "   " },
    { ...candidate, relation: "CONTEXT" },
    { ...candidate, relation: "NEUTRAL" },
    { ...candidate, relation: "INVALID" },
    { ...candidate, runId: "different-run" },
    { ...candidate, claimId: "different-claim" },
  ];
  for (const value of malformed) {
    assert.throws(() => validateResearchResult(request, {
      artifacts: [],
      edges: [],
      evidence: [value],
    }));
  }
});
