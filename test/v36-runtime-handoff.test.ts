import assert from "node:assert/strict";
import test from "node:test";
import { laptopFixture } from "./fixtures/legacy-laptop-fixture.js";
import {
  admitV36ResumeResults,
  createV36NeedsResearch,
  type V36ResearchRequest,
} from "../src/truth/continuation.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";
import { prepareV36RuntimeResume } from "../src/truth/runtime-handoff.js";
import type {
  DurableV36ContinuationLoadResult,
  DurableV36ExecutionResult,
} from "../src/v36-research-bridge.js";

async function oneRequestYield(runId: string) {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const investigation = await pipeline.investigate(runId);
  const claimId = investigation.snapshot.bundle.claims[0]?.id;
  assert.ok(claimId);
  const request: V36ResearchRequest = {
    id: `${runId}-research`,
    runId,
    claimId,
    parentRequestId: null,
    purpose: "SUPPORT",
    query: "Find supporting evidence.",
    serialRound: 1,
  };
  return createV36NeedsResearch(investigation.snapshot, [request], 1);
}

test("ready durable bridge results enter canonical V36 admission through the fail-closed handoff", async () => {
  const yielded = await oneRequestYield("run-v36-runtime-handoff-ready");
  const runtimeResult: DurableV36ExecutionResult = {
    requestId: yielded.researchRequests[0]!.id,
    runId: yielded.checkpoint.runId,
    outcome: "SUCCEEDED",
    result: {
      artifacts: [],
      edges: [],
      evidence: [{
        artifactId: "runtime-artifact",
        externalEvidenceId: "runtime-observation",
        relation: "SUPPORTS",
        specificEvidence: "Durable untrusted observation.",
        admitted: true,
        verification: "VERIFIED",
        authoritativePrimary: true,
      }],
    },
    operationalFailure: null,
  };
  const ready: Extract<DurableV36ContinuationLoadResult, { outcome: "ready" }> = {
    outcome: "ready",
    checkpoint: yielded.checkpoint,
    results: [runtimeResult],
  };

  const prepared = prepareV36RuntimeResume(ready.checkpoint, ready.results);
  const admitted = admitV36ResumeResults(prepared.checkpoint, prepared.results);
  const result = admitted.results[0];
  assert.ok(result && result.outcome === "SUCCEEDED");
  const evidence = result.truthResult.evidence[0];
  assert.ok(evidence);
  assert.equal(evidence.admitted, false);
  assert.equal(evidence.verification, "UNVERIFIED");
  assert.equal(evidence.authoritativePrimary, false);
  assert.equal(evidence.provenanceComponentKey, null);
});

test("malformed successful durable payload fails closed before canonical V36 resume", async () => {
  const yielded = await oneRequestYield("run-v36-runtime-handoff-malformed");
  const malformed: DurableV36ExecutionResult = {
    requestId: yielded.researchRequests[0]!.id,
    runId: yielded.checkpoint.runId,
    outcome: "SUCCEEDED",
    result: { artifacts: "not-an-array", edges: [], evidence: [] },
    operationalFailure: null,
  };

  assert.throws(
    () => prepareV36RuntimeResume(yielded.checkpoint, [malformed]),
    /must contain artifacts, edges, and evidence arrays/u,
  );
});

test("operational durable failure remains operational-only through the handoff", async () => {
  const yielded = await oneRequestYield("run-v36-runtime-handoff-operational");
  const failure: DurableV36ExecutionResult = {
    requestId: yielded.researchRequests[0]!.id,
    runId: yielded.checkpoint.runId,
    outcome: "OPERATIONAL_FAILURE",
    result: null,
    operationalFailure: {
      code: "RESEARCH_TASK_EXHAUSTED",
      message: "Durable task exhausted.",
      retryable: false,
    },
  };

  const prepared = prepareV36RuntimeResume(yielded.checkpoint, [failure]);
  const admitted = admitV36ResumeResults(prepared.checkpoint, prepared.results);
  const result = admitted.results[0];
  assert.ok(result && result.outcome === "OPERATIONAL_FAILURE");
  assert.equal(result.truthResult, null);
  assert.equal(result.operationalFailure.code, "RESEARCH_TASK_EXHAUSTED");
});

test("runtime handoff rejects successful payloads whose artifacts cross Run scope", async () => {
  const yielded = await oneRequestYield("run-v36-runtime-handoff-scope");
  const crossRun: DurableV36ExecutionResult = {
    requestId: yielded.researchRequests[0]!.id,
    runId: yielded.checkpoint.runId,
    outcome: "SUCCEEDED",
    result: {
      artifacts: [{
        id: "artifact-cross-run",
        runId: "different-run",
        canonicalUri: "fixture://cross-run",
        artifactHash: "hash",
        publisher: null,
        originKey: null,
        provenanceComponentKey: null,
        provenanceConfidence: "UNKNOWN",
        authoritativePrimary: false,
        retrievedAt: "2026-08-28T00:00:00.000Z",
        publishedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
        contentType: "text/plain",
        metadata: {},
        untrusted: true,
      }],
      edges: [],
      evidence: [],
    },
    operationalFailure: null,
  };

  assert.throws(
    () => prepareV36RuntimeResume(yielded.checkpoint, [crossRun]),
    /Research artifact crossed Run scope/u,
  );
});
