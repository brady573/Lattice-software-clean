import assert from "node:assert/strict";
import test from "node:test";
import { createDecisionFromAdmittedEvidence } from "../src/engine.js";
import type { DecisionFixtureDataset } from "../src/truth/fixture-dataset.js";
import { laptopFixture } from "./fixtures/legacy-laptop-fixture.js";
import { materializeDecisionEvidence } from "../src/truth/admission.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { buildCorroborationRequest } from "../src/truth/corroboration.js";
import { buildFalsificationRequest } from "../src/truth/falsification.js";
import { stableTruthUuid } from "../src/truth/ids.js";
import { assertTruthBundleIntegrity } from "../src/truth/invariants.js";
import {
  DormantLiveResearchProvider,
  OfflineFixtureResearchAdmissionPolicy,
  OfflineFixtureResearchProvider,
} from "../src/truth/pipeline.js";
import type { ProofCheckStatus, SourceArtifact } from "../src/truth/types.js";

const runId = "00000000-0000-4000-8000-000000000336";

function passedChecks(): Readonly<Record<string, ProofCheckStatus>> {
  return Object.fromEntries(
    requiredProofObligations("CAUSAL").map((kind) => [kind, "PASSED"] as const),
  );
}

function causalDataset(): DecisionFixtureDataset {
  return {
    candidates: [{ id: "candidate", label: "Candidate" }],
    evidence: [{
      id: "support-a",
      candidateId: "candidate",
      criterion: "effect",
      value: true,
      sourceId: "origin-a",
      sourceLabel: "Origin A",
      admitted: true,
    }],
    truthClaims: [{
      id: "claim-effect",
      text: "A causes the candidate effect",
      claimType: "CAUSAL",
      candidateId: "candidate",
      criterion: "effect",
      evidenceIds: ["support-a"],
      scope: "candidate",
      causalRelation: "causes",
      evidenceRisk: "ORDINARY",
      checks: passedChecks(),
      materiallyMisleading: false,
    }],
    truthEvidence: [{
      evidenceId: "support-a",
      claimId: "claim-effect",
      provenanceComponentKey: "origin-a",
      provenanceConfidence: "HIGH",
      relation: "SUPPORTS",
      sourceAccepted: true,
      authoritativePrimary: true,
      verification: "VERIFIED",
    }],
  };
}

function researchSource(label: string): SourceArtifact {
  const id = stableTruthUuid(`${runId}:research-source:${label}`);
  return {
    id,
    runId,
    canonicalUri: `fixture://${label}`,
    artifactHash: `hash-${label}`,
    publisher: "Untrusted provider metadata",
    originKey: "provider-claimed-origin",
    provenanceComponentKey: "provider-claimed-component",
    provenanceConfidence: "HIGH",
    authoritativePrimary: true,
    retrievedAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    contentType: "text/plain",
    metadata: {},
    untrusted: true,
  };
}

function admittedSecondOriginPolicy(requestId: string, evidenceId: string): OfflineFixtureResearchAdmissionPolicy {
  return new OfflineFixtureResearchAdmissionPolicy({
    [requestId]: {
      [evidenceId]: {
        verification: "VERIFIED",
        admitted: true,
        rejectionReason: null,
        provenanceComponentKey: "origin-b",
        provenanceConfidence: "HIGH",
        authoritativePrimary: true,
      },
    },
  });
}

test("bounded research enriches persisted V36 truth before decision admission", async () => {
  const dataset = causalDataset();
  const base = evaluateFixtureTruth(runId, dataset);
  assert.equal(base.assessments[0]?.verdict, "UNVERIFIED");

  const claim = base.bundle.claims[0];
  assert.ok(claim);
  const falsification = buildFalsificationRequest(claim, 1);
  const corroboration = buildCorroborationRequest(claim, 1);
  const sourceB = researchSource("source-b");
  const provider = new OfflineFixtureResearchProvider(
    {
      [falsification.id]: { artifacts: [], edges: [], evidence: [] },
      [corroboration.id]: {
        artifacts: [sourceB],
        edges: [],
        evidence: [{
          artifactId: sourceB.id,
          externalEvidenceId: "support-b",
          relation: "SUPPORTS",
          specificEvidence: "Independent origin confirms the effect.",
        }],
      },
    },
    admittedSecondOriginPolicy(corroboration.id, "support-b"),
  );

  const result = await new OfflineFixtureTruthPipeline(dataset, provider).execute(runId);
  assertTruthBundleIntegrity(result.bundle);
  assert.equal(result.bundle.assessments[0]?.verdict, "TRUE");
  assert.deepEqual(
    result.bundle.researchQuestions.map((item) => item.purpose).sort(),
    ["DISCONFIRM", "INDEPENDENT_CORROBORATION"],
  );
  assert.deepEqual(
    result.bundle.provenanceComponents.map((item) => item.key).sort(),
    ["origin-a", "origin-b"],
  );

  const normalizedSourceB = result.bundle.sources.find((item) => item.id === sourceB.id);
  assert.equal(normalizedSourceB?.provenanceComponentKey, "origin-b");
  assert.equal(normalizedSourceB?.originKey, "origin-b");
  const researchEvidence = result.bundle.claimEvidence.find((item) => item.externalEvidenceId === "support-b");
  assert.equal(researchEvidence?.researchQuestionId, corroboration.id);
  assert.equal(researchEvidence?.provenanceComponentKey, "origin-b");
  assert.equal(researchEvidence?.verification, "VERIFIED");
  assert.equal(researchEvidence?.admitted, true);

  const decisionEvidence = materializeDecisionEvidence(
    dataset.evidence,
    result.bundle.claimEvidence,
    result.bundle.assessments,
  );
  assert.deepEqual(decisionEvidence.map((item) => item.id), ["support-a"]);
  const decision = createDecisionFromAdmittedEvidence(
    {
      goal: "Choose the established candidate",
      hardConstraints: [{ criterion: "effect", operator: "eq", value: true }],
      priorities: [{ criterion: "effect", weight: 1 }],
    },
    dataset.candidates,
    decisionEvidence,
    result.bundle.assessments.map((item) => item.id),
  );
  assert.equal(decision.winnerCandidateId, "candidate");
});

test("research provenance edges collapse a claimed second origin before positive release", async () => {
  const dataset = causalDataset();
  const base = evaluateFixtureTruth(runId, dataset);
  const claim = base.bundle.claims[0];
  const sourceA = base.bundle.sources[0];
  assert.ok(claim);
  assert.ok(sourceA);
  const falsification = buildFalsificationRequest(claim, 1);
  const corroboration = buildCorroborationRequest(claim, 1);
  const sourceB = researchSource("copied-source-b");
  const provider = new OfflineFixtureResearchProvider(
    {
      [falsification.id]: { artifacts: [], edges: [], evidence: [] },
      [corroboration.id]: {
        artifacts: [sourceB],
        edges: [{
          id: stableTruthUuid(`${runId}:research-edge:copy`),
          runId,
          fromArtifactId: sourceB.id,
          toArtifactId: sourceA.id,
          edgeType: "COPIES",
          confidence: 0.99,
          contentSimilarity: 0.99,
        }],
        evidence: [{
          artifactId: sourceB.id,
          externalEvidenceId: "support-b-copy",
          relation: "SUPPORTS",
          specificEvidence: "A copied report repeats the effect.",
        }],
      },
    },
    admittedSecondOriginPolicy(corroboration.id, "support-b-copy"),
  );

  const result = await new OfflineFixtureTruthPipeline(dataset, provider).execute(runId);
  assertTruthBundleIntegrity(result.bundle);
  assert.equal(result.bundle.assessments[0]?.verdict, "UNVERIFIED");
  assert.equal(result.bundle.provenanceComponents.length, 1);
  assert.equal(
    new Set(result.bundle.claimEvidence.map((item) => item.provenanceComponentKey)).size,
    1,
  );
  const copiedEvidence = result.bundle.claimEvidence.find((item) => item.externalEvidenceId === "support-b-copy");
  assert.equal(copiedEvidence?.authoritativePrimary, false);
});

test("research cannot replace an existing material decision evidence identity", async () => {
  const dataset = causalDataset();
  const base = evaluateFixtureTruth(runId, dataset);
  const claim = base.bundle.claims[0];
  assert.ok(claim);
  const falsification = buildFalsificationRequest(claim, 1);
  const corroboration = buildCorroborationRequest(claim, 1);
  const sourceB = researchSource("collision-source");
  const provider = new OfflineFixtureResearchProvider(
    {
      [falsification.id]: { artifacts: [], edges: [], evidence: [] },
      [corroboration.id]: {
        artifacts: [sourceB],
        edges: [],
        evidence: [{
          artifactId: sourceB.id,
          externalEvidenceId: "support-a",
          relation: "SUPPORTS",
          specificEvidence: "Attempted replacement.",
        }],
      },
    },
    admittedSecondOriginPolicy(corroboration.id, "support-a"),
  );

  await assert.rejects(
    new OfflineFixtureTruthPipeline(dataset, provider).execute(runId),
    /Research attempted to replace existing claim evidence support-a/,
  );
});

test("no-op offline research preserves the canonical fixture truth bundle exactly", async () => {
  const canonicalRunId = "00000000-0000-4000-8000-000000000337";
  const direct = evaluateFixtureTruth(canonicalRunId, laptopFixture);
  const result = await new OfflineFixtureTruthPipeline(laptopFixture).execute(canonicalRunId);
  assert.deepEqual(result.bundle, direct.bundle);
  assert.equal(result.serialRounds, direct.serialRounds);
});

test("offline truth execution rejects live-provider activation", () => {
  assert.throws(
    () => new OfflineFixtureTruthPipeline(laptopFixture, new DormantLiveResearchProvider()),
    /cannot activate a live research provider/,
  );
});
