import assert from "node:assert/strict";
import test from "node:test";
import {
  OfflineFixtureResearchAdmissionPolicy,
  OfflineFixtureResearchProvider,
  researchWithAdmission,
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
