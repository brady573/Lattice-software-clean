import assert from "node:assert/strict";
import test from "node:test";
import { laptopFixture, type FixtureDataset } from "../src/fixtures.js";
import {
  OfflineFixtureTruthPipeline,
  type TruthDurableValidationStep,
} from "../src/truth/execution-pipeline.js";
import type { V36UntrustedResearchExecutionResult } from "../src/truth/continuation.js";

function researchNeedingFixture(): FixtureDataset {
  const fixture = structuredClone(laptopFixture);
  const firstEvidence = fixture.truthEvidence[0];
  assert.ok(firstEvidence);
  fixture.truthEvidence[0] = {
    ...firstEvidence,
    authoritativePrimary: false,
  };
  return fixture;
}

test("V36 alone advances bounded durable research rounds after operational failures", async () => {
  const pipeline = new OfflineFixtureTruthPipeline(researchNeedingFixture());
  const investigation = await pipeline.investigate("run-v36-durable-rounds");
  const initialEvidence = structuredClone(investigation.snapshot.bundle.claimEvidence);
  const initial = await pipeline.beginDurableValidation(investigation.snapshot);
  assert.equal(initial.kind, "NEEDS_RESEARCH");
  if (initial.kind !== "NEEDS_RESEARCH") return;

  let step: TruthDurableValidationStep = initial;
  const checkpointHashes = new Set<string>();
  let rounds = 0;
  while (step.kind === "NEEDS_RESEARCH") {
    rounds += 1;
    assert.ok(rounds <= 8, "durable validation exceeded its bounded research protocol");
    assert.equal(checkpointHashes.has(step.checkpoint.checkpointHash), false);
    checkpointHashes.add(step.checkpoint.checkpointHash);

    const results: V36UntrustedResearchExecutionResult[] = step.researchRequests.map((request) => ({
      requestId: request.id,
      runId: request.runId,
      outcome: "OPERATIONAL_FAILURE",
      result: null,
      operationalFailure: {
        code: "RESEARCH_TASK_EXHAUSTED",
        message: "No qualified execution driver was available.",
        retryable: false,
      },
    }));
    step = await pipeline.resumeDurableValidation(step.checkpoint, results);
  }

  assert.ok(rounds >= 2, "fixture should exercise at least one subsequent V36 research round");
  assert.equal(step.kind, "VALIDATED");
  assert.equal(step.execution.snapshot.phase, "VALIDATED");
  assert.deepEqual(step.execution.snapshot.bundle.claimEvidence, initialEvidence);
  assert.ok(
    step.execution.snapshot.bundle.researchQuestions.length
      > investigation.snapshot.bundle.researchQuestions.length,
    "V36 should retain the attempted research questions without manufacturing evidence",
  );
});

test("V36 rejects malformed opaque durable provider results before admission", async () => {
  const pipeline = new OfflineFixtureTruthPipeline(researchNeedingFixture());
  const investigation = await pipeline.investigate("run-v36-opaque-result");
  const initial = await pipeline.beginDurableValidation(investigation.snapshot);
  assert.equal(initial.kind, "NEEDS_RESEARCH");
  if (initial.kind !== "NEEDS_RESEARCH") return;
  const request = initial.researchRequests[0];
  assert.ok(request);

  const malformed: V36UntrustedResearchExecutionResult[] = initial.researchRequests.map((item) => ({
    requestId: item.id,
    runId: item.runId,
    outcome: "SUCCEEDED",
    result: item.id === request.id ? { providerSaysVerified: true } : { artifacts: [], edges: [], evidence: [] },
    operationalFailure: null,
  }));

  await assert.rejects(
    pipeline.resumeDurableValidation(initial.checkpoint, malformed),
    /V36 successful runtime research result must contain artifacts, edges, and evidence arrays/,
  );
});
