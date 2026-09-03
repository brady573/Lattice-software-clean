import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { RunRequest } from "../src/domain.js";
import {
  createLegacyDecisionTruthComposition,
  laptopFixture,
} from "./fixtures/legacy-laptop-fixture.js";
import {
  createPendingRun,
  executePersistedRun,
  executePersistedRunTick,
  RunExecutionError,
} from "../src/run-execution.js";
import {
  MemoryRunStore,
  type RunTransition,
  type RunTransitionResult,
} from "../src/run-store.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

test("Run coordinator tick advances at most one durable epoch and remains resumable", async () => {
  const store = new MemoryRunStore();
  const { truthPipeline: pipeline, decisionEvidenceProvider } = createLegacyDecisionTruthComposition();
  const run = createPendingRun("coordinator-tick", request, randomUUID());
  await store.create(run);

  try {
    const expected = [
      ["UNDERSTANDING", 2],
      ["PLANNING", 3],
      ["INVESTIGATING", 4],
      ["VALIDATING", 5],
      ["DECIDING", 6],
      ["DECIDING", 7],
      ["COMPLETED", 8],
    ] as const;

    for (const [status, version] of expected) {
      const before = await store.get(run.id);
      assert.ok(before);
      const after = await executePersistedRunTick(
        store,
        pipeline,
        run.id,
        undefined,
        undefined,
        decisionEvidenceProvider,
      );
      assert.equal(after.status, status);
      assert.equal(after.version, version);
      assert.equal(after.version, before.version + 1);
    }

    const completed = await store.get(run.id);
    assert.ok(completed);
    assert.equal(completed.status, "COMPLETED");
    assert.ok(completed.decision);
    assert.ok(completed.explanation);
    assert.deepEqual(
      completed.events.map((event) => event.type),
      ["CREATED", "UNDERSTANDING", "PLANNING", "INVESTIGATING", "VALIDATING", "DECIDING", "EXPLAINING", "COMPLETED"],
    );

    const settled = await executePersistedRunTick(
      store,
      pipeline,
      run.id,
      undefined,
      undefined,
      decisionEvidenceProvider,
    );
    assert.equal(settled.status, "COMPLETED");
    assert.equal(settled.version, 8);

    const compatibility = await executePersistedRun(
      store,
      pipeline,
      run.id,
      undefined,
      undefined,
      decisionEvidenceProvider,
    );
    assert.equal(compatibility.status, "COMPLETED");
    assert.equal(compatibility.version, 8);
  } finally {
    await store.close();
  }
});

class StaleTransitionRunStore extends MemoryRunStore {
  override async transition(_input: RunTransition): Promise<RunTransitionResult> {
    return { outcome: "stale" };
  }
}

test("Run coordinator tick reports lost epoch ownership as retryable without overwriting state", async () => {
  const store = new StaleTransitionRunStore();
  const pipeline = new OfflineFixtureTruthPipeline(laptopFixture);
  const run = createPendingRun("coordinator-stale", request, randomUUID());
  await store.create(run);

  try {
    await assert.rejects(
      executePersistedRunTick(store, pipeline, run.id),
      (error: unknown) => error instanceof RunExecutionError && error.retryable,
    );
    const persisted = await store.get(run.id);
    assert.ok(persisted);
    assert.equal(persisted.status, "CREATED");
    assert.equal(persisted.version, 1);
  } finally {
    await store.close();
  }
});
