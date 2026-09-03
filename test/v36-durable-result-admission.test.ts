import assert from "node:assert/strict";
import test from "node:test";
import { laptopFixture } from "./fixtures/legacy-laptop-fixture.js";
import {
  admitV36ResumeResults,
  createV36NeedsResearch,
  type V36ResearchExecutionResult,
  type V36ResearchRequest,
} from "../src/truth/continuation.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";
import {
  OfflineFixtureResearchAdmissionPolicy,
  type ResearchEvidenceCandidate,
} from "../src/truth/pipeline.js";

async function oneRequestYield(runId: string) {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const investigation = await pipeline.investigate(runId);
  const claimId = investigation.snapshot.bundle.claims[0]?.id;
  assert.ok(claimId);
  const request: V36ResearchRequest = {
    id: `${runId}-research-1`,
    runId: investigation.snapshot.runId,
    claimId,
    parentRequestId: null,
    purpose: "SUPPORT",
    query: "Find support for the first material claim.",
    serialRound: 1,
  };
  return createV36NeedsResearch(investigation.snapshot, [request], 1);
}

function successfulResult(
  yielded: Awaited<ReturnType<typeof oneRequestYield>>,
  candidate: ResearchEvidenceCandidate,
): V36ResearchExecutionResult {
  return {
    requestId: yielded.researchRequests[0]!.id,
    runId: yielded.checkpoint.runId,
    outcome: "SUCCEEDED",
    result: {
      artifacts: [],
      edges: [],
      evidence: [candidate],
    },
    operationalFailure: null,
  };
}

test("durable provider success cannot manufacture V36 evidence authority", async () => {
  const yielded = await oneRequestYield("run-v36-durable-admission-default");
  const candidate = {
    artifactId: "artifact-runtime",
    externalEvidenceId: "runtime-evidence",
    relation: "SUPPORTS",
    specificEvidence: "Untrusted durable provider observation.",
    admitted: true,
    verification: "VERIFIED",
    provenanceComponentKey: "fabricated-independent-origin",
    provenanceConfidence: "HIGH",
    authoritativePrimary: true,
    rejectionReason: null,
  } as ResearchEvidenceCandidate;

  const before = structuredClone(yielded.checkpoint.snapshot);
  const admitted = admitV36ResumeResults(
    yielded.checkpoint,
    [successfulResult(yielded, candidate)],
  );

  const result = admitted.results[0];
  assert.ok(result && result.outcome === "SUCCEEDED");
  const evidence = result.truthResult.evidence[0];
  assert.ok(evidence);
  assert.equal(evidence.admitted, false);
  assert.equal(evidence.verification, "UNVERIFIED");
  assert.equal(evidence.provenanceComponentKey, null);
  assert.equal(evidence.provenanceConfidence, "UNKNOWN");
  assert.equal(evidence.authoritativePrimary, false);
  assert.match(evidence.rejectionReason ?? "", /has not passed V36 truth-layer admission/u);
  assert.deepEqual(admitted.checkpoint.snapshot, before);
});

test("explicit V36 admission policy can admit a durable provider observation", async () => {
  const yielded = await oneRequestYield("run-v36-durable-admission-authorized");
  const requestId = yielded.researchRequests[0]!.id;
  const candidate: ResearchEvidenceCandidate = {
    artifactId: "artifact-authorized",
    externalEvidenceId: "authorized-evidence",
    relation: "SUPPORTS",
    specificEvidence: "Deterministic fixture observation admitted by V36 policy.",
  };
  const policy = new OfflineFixtureResearchAdmissionPolicy({
    [requestId]: {
      [candidate.externalEvidenceId]: {
        verification: "VERIFIED",
        admitted: true,
        rejectionReason: null,
        provenanceComponentKey: "fixture-origin",
        provenanceConfidence: "HIGH",
        authoritativePrimary: true,
      },
    },
  });

  const admitted = admitV36ResumeResults(
    yielded.checkpoint,
    [successfulResult(yielded, candidate)],
    policy,
  );
  const result = admitted.results[0];
  assert.ok(result && result.outcome === "SUCCEEDED");
  const evidence = result.truthResult.evidence[0];
  assert.ok(evidence);
  assert.equal(evidence.admitted, true);
  assert.equal(evidence.verification, "VERIFIED");
  assert.equal(evidence.provenanceComponentKey, "fixture-origin");
  assert.equal(evidence.provenanceConfidence, "HIGH");
  assert.equal(evidence.authoritativePrimary, true);
  assert.equal(evidence.researchQuestionId, requestId);
});

test("M8 continuity does not silently reuse historical external facts as V36 truth", async () => {
  const historical = await oneRequestYield("run-m8-historical-fact");
  const requestId = historical.researchRequests[0]!.id;
  const historicalEvidenceId = "m8-historical-external-evidence";
  const candidate: ResearchEvidenceCandidate = {
    artifactId: "artifact-m8-historical",
    externalEvidenceId: historicalEvidenceId,
    relation: "SUPPORTS",
    specificEvidence: "A fact admitted only for the historical Run.",
  };
  const policy = new OfflineFixtureResearchAdmissionPolicy({
    [requestId]: {
      [historicalEvidenceId]: {
        verification: "VERIFIED",
        admitted: true,
        rejectionReason: null,
        provenanceComponentKey: "m8-historical-origin",
        provenanceConfidence: "HIGH",
        authoritativePrimary: true,
      },
    },
  });

  const admittedHistorical = admitV36ResumeResults(
    historical.checkpoint,
    [successfulResult(historical, candidate)],
    policy,
  );
  const admittedEvidence = admittedHistorical.results[0]?.outcome === "SUCCEEDED"
    ? admittedHistorical.results[0].truthResult.evidence[0]
    : undefined;
  assert.equal(admittedEvidence?.externalEvidenceId, historicalEvidenceId);
  assert.equal(admittedEvidence?.admitted, true);

  const later = await oneRequestYield("run-m8-later-independent");
  assert.notEqual(later.checkpoint.runId, historical.checkpoint.runId);
  assert.equal(JSON.stringify(later.checkpoint.snapshot).includes(historicalEvidenceId), false);
  assert.equal(JSON.stringify(later).includes(historicalEvidenceId), false);
});

test("operational failure produces no truth evidence or verdict", async () => {
  const yielded = await oneRequestYield("run-v36-durable-admission-operational");
  const result: V36ResearchExecutionResult = {
    requestId: yielded.researchRequests[0]!.id,
    runId: yielded.checkpoint.runId,
    outcome: "OPERATIONAL_FAILURE",
    result: null,
    operationalFailure: {
      code: "BUDGET_EXHAUSTED",
      message: "Runtime budget exhausted.",
      retryable: false,
    },
  };

  const before = structuredClone(yielded.checkpoint.snapshot);
  const admitted = admitV36ResumeResults(yielded.checkpoint, [result]);
  const admittedResult = admitted.results[0];
  assert.ok(admittedResult && admittedResult.outcome === "OPERATIONAL_FAILURE");
  assert.equal(admittedResult.truthResult, null);
  assert.equal(admittedResult.operationalFailure.code, "BUDGET_EXHAUSTED");
  assert.deepEqual(admitted.checkpoint.snapshot, before);
});

test("durable result admission rejects provider observations that cross Run scope", async () => {
  const yielded = await oneRequestYield("run-v36-durable-admission-scope");
  const candidate = {
    artifactId: "artifact-cross-run",
    externalEvidenceId: "cross-run-evidence",
    relation: "SUPPORTS",
    specificEvidence: "Wrong Run scope.",
    runId: "different-run",
  } as ResearchEvidenceCandidate;

  assert.throws(
    () => admitV36ResumeResults(
      yielded.checkpoint,
      [successfulResult(yielded, candidate)],
    ),
    /Research evidence crossed Run or claim scope/u,
  );
});
