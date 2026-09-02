import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import { laptopFixture } from "../src/fixtures.js";
import { MemoryRunStore } from "../src/run-store.js";
import { evaluateFixtureTruth } from "../src/truth/fixture-evaluation.js";
import { createTruthSnapshot } from "../src/truth/snapshot.js";

const request: RunRequest = {
  goal: "Exercise durable V36 snapshot epochs.",
  hardConstraints: [{ criterion: "price", operator: "lte", value: 1300 }],
  priorities: [{ criterion: "performance", weight: 1 }],
};

function investigatingRun(runId: string): LatticeRun {
  return {
    id: runId,
    conversationId: "snapshot-test",
    status: "INVESTIGATING",
    version: 4,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [
      { sequence: 1, type: "CREATED" },
      { sequence: 2, type: "UNDERSTANDING" },
      { sequence: 3, type: "PLANNING" },
      { sequence: 4, type: "INVESTIGATING" },
    ],
  };
}

test("V36 snapshot phase controls the only permitted persistence transition", async () => {
  const runId = "00000000-0000-4000-8000-000000001436";
  const store = new MemoryRunStore();
  await store.create(investigatingRun(runId));
  const bundle = evaluateFixtureTruth(runId, laptopFixture).bundle;
  const investigated = createTruthSnapshot("INVESTIGATED", "contract-a", bundle);
  const validated = createTruthSnapshot("VALIDATED", "contract-a", bundle);

  await assert.rejects(
    store.transition({
      runId,
      expectedStatus: "INVESTIGATING",
      expectedVersion: 4,
      nextStatus: "VALIDATING",
      truthSnapshot: validated,
    }),
    /VALIDATED truth snapshot cannot be committed/,
  );

  const advanced = await store.transition({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    nextStatus: "VALIDATING",
    truthSnapshot: investigated,
  });
  assert.deepEqual(advanced, { outcome: "advanced", version: 5 });
});

test("stale Run epoch cannot overwrite the accepted V36 snapshot", async () => {
  const runId = "00000000-0000-4000-8000-000000001536";
  const store = new MemoryRunStore();
  await store.create(investigatingRun(runId));
  const bundle = evaluateFixtureTruth(runId, laptopFixture).bundle;
  const accepted = createTruthSnapshot("INVESTIGATED", "contract-a", bundle);

  assert.deepEqual(
    await store.transition({
      runId,
      expectedStatus: "INVESTIGATING",
      expectedVersion: 4,
      nextStatus: "VALIDATING",
      truthSnapshot: accepted,
    }),
    { outcome: "advanced", version: 5 },
  );

  const competingBundle = structuredClone(bundle);
  const claim = competingBundle.claims[0];
  assert.ok(claim);
  claim.quotedContext = "competing stale state";
  const competing = createTruthSnapshot("INVESTIGATED", "contract-a", competingBundle);
  const stale = await store.transition({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    nextStatus: "VALIDATING",
    truthSnapshot: competing,
  });
  assert.deepEqual(stale, { outcome: "stale" });

  const persisted = await store.getTruthSnapshot(runId);
  assert.ok(persisted);
  assert.equal(persisted.bundleHash, accepted.bundleHash);
  assert.equal(persisted.bundle.claims[0]?.quotedContext, bundle.claims[0]?.quotedContext ?? null);
});
