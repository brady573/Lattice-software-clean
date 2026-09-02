import assert from "node:assert/strict";
import test from "node:test";
import { laptopFixture } from "../src/fixtures.js";
import {
  assertV36ResearchCheckpointIntegrity,
  createV36NeedsResearch,
  prepareV36Resume,
  type V36ResearchExecutionResult,
  type V36ResearchRequest,
} from "../src/truth/continuation.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

async function fixtureYield() {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const investigation = await pipeline.investigate("run-v36-continuation");
  const claimId = investigation.snapshot.bundle.claims[0]?.id;
  assert.ok(claimId);
  const requests: V36ResearchRequest[] = [
    {
      id: "research-1",
      runId: investigation.snapshot.runId,
      claimId,
      parentRequestId: null,
      purpose: "SUPPORT",
      query: "Find support for the first material claim.",
      serialRound: 1,
    },
    {
      id: "research-2",
      runId: investigation.snapshot.runId,
      claimId,
      parentRequestId: "research-1",
      purpose: "DISCONFIRM",
      query: "Seek independent disconfirming evidence.",
      serialRound: 2,
    },
  ];
  return createV36NeedsResearch(investigation.snapshot, requests, 1);
}

test("V36 NEEDS_RESEARCH checkpoint is complete and tamper-evident", async () => {
  const yielded = await fixtureYield();
  assert.equal(yielded.kind, "NEEDS_RESEARCH");
  assert.equal(yielded.checkpoint.version, 1);
  assert.equal(yielded.checkpoint.researchRequests.length, 2);
  assert.equal(yielded.researchRequests, yielded.checkpoint.researchRequests);
  assertV36ResearchCheckpointIntegrity(yielded.checkpoint);

  const tampered = structuredClone(yielded.checkpoint);
  tampered.researchRequests[0]!.query = "changed after checkpoint";
  assert.throws(
    () => assertV36ResearchCheckpointIntegrity(tampered),
    /checkpoint hash does not match/u,
  );
});

test("V36 continuation checkpoint is detached from mutable caller input", async () => {
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const investigation = await pipeline.investigate("run-v36-detached");
  const claimId = investigation.snapshot.bundle.claims[0]?.id;
  assert.ok(claimId);
  const requests: V36ResearchRequest[] = [{
    id: "research-detached",
    runId: investigation.snapshot.runId,
    claimId,
    parentRequestId: null,
    purpose: "PRIMARY_SOURCE",
    query: "Locate the primary source.",
    serialRound: 1,
  }];

  const yielded = createV36NeedsResearch(investigation.snapshot, requests, 1);
  requests[0]!.query = "caller mutation";
  investigation.snapshot.bundle.claims[0]!.text = "caller mutation";

  assert.equal(yielded.checkpoint.researchRequests[0]!.query, "Locate the primary source.");
  assert.notEqual(yielded.checkpoint.snapshot.bundle.claims[0]!.text, "caller mutation");
  assertV36ResearchCheckpointIntegrity(yielded.checkpoint);
});

test("V36 resume requires exactly one result for each requested research item", async () => {
  const yielded = await fixtureYield();
  const success: V36ResearchExecutionResult = {
    requestId: "research-1",
    runId: yielded.checkpoint.runId,
    outcome: "SUCCEEDED",
    result: { artifacts: [], edges: [], evidence: [] },
    operationalFailure: null,
  };
  const failure: V36ResearchExecutionResult = {
    requestId: "research-2",
    runId: yielded.checkpoint.runId,
    outcome: "OPERATIONAL_FAILURE",
    result: null,
    operationalFailure: {
      code: "PROVIDER_UNAVAILABLE",
      message: "Research provider unavailable.",
      retryable: true,
    },
  };

  const prepared = prepareV36Resume(yielded.checkpoint, [success, failure]);
  assert.deepEqual(prepared.results, [success, failure]);

  assert.throws(
    () => prepareV36Resume(yielded.checkpoint, [success]),
    /missing execution results/u,
  );
  assert.throws(
    () => prepareV36Resume(yielded.checkpoint, [success, success, failure]),
    /duplicate results/u,
  );
  assert.throws(
    () => prepareV36Resume(yielded.checkpoint, [
      success,
      { ...failure, requestId: "not-requested" },
    ]),
    /unrequested result/u,
  );
});

test("operational inability remains operational data and is not converted into truth state", async () => {
  const yielded = await fixtureYield();
  const results: V36ResearchExecutionResult[] = yielded.researchRequests.map((request) => ({
    requestId: request.id,
    runId: request.runId,
    outcome: "OPERATIONAL_FAILURE" as const,
    result: null,
    operationalFailure: {
      code: "BUDGET_EXHAUSTED",
      message: "Operational research budget exhausted.",
      retryable: false,
    },
  }));

  const prepared = prepareV36Resume(yielded.checkpoint, results);
  assert.equal(prepared.checkpoint.snapshot.phase, "INVESTIGATED");
  assert.equal(prepared.checkpoint.snapshot.bundle.assessments.length, yielded.checkpoint.snapshot.bundle.assessments.length);
  assert.ok(prepared.results.every((result) => result.outcome === "OPERATIONAL_FAILURE"));
});

test("V36 continuation rejects cross-run and structurally invalid research envelopes", async () => {
  const yielded = await fixtureYield();
  const invalidRequest = structuredClone(yielded.researchRequests[0]!);
  invalidRequest.runId = "different-run";
  assert.throws(
    () => createV36NeedsResearch(yielded.checkpoint.snapshot, [invalidRequest], 2),
    /Run scope does not match/u,
  );

  const invalidParent = structuredClone(yielded.researchRequests[0]!);
  invalidParent.parentRequestId = "missing-parent";
  assert.throws(
    () => createV36NeedsResearch(yielded.checkpoint.snapshot, [invalidParent], 2),
    /unknown parent request/u,
  );
});
