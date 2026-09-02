import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import {
  MemoryOrchestrationStore,
  assertResearchTaskGraph,
  defineResearchTask,
} from "../src/orchestration-store.js";
import { MemoryRunStore } from "../src/run-store.js";

const request: RunRequest = {
  goal: "Exercise durable research orchestration.",
  hardConstraints: [],
  priorities: [],
};

function investigatingRun(id: string): LatticeRun {
  return {
    id,
    conversationId: `orchestration-${id}`,
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

async function fixture() {
  const runStore = new MemoryRunStore();
  const runId = "00000000-0000-4000-8000-000000001500";
  await runStore.create(investigatingRun(runId));
  const store = new MemoryOrchestrationStore(runStore);
  return { runId, runStore, store };
}

test("research task identity is deterministic and excludes dependency/retry execution strategy", () => {
  const base = defineResearchTask({
    runId: "run-a",
    planVersion: 2,
    normalizedInputs: { query: "battery life", scope: { candidate: "nova" } },
    contextVersionIds: ["truth:v2", "intent:v4"],
    maxAttempts: 1,
  });
  const reordered = defineResearchTask({
    runId: "run-a",
    planVersion: 2,
    normalizedInputs: { scope: { candidate: "nova" }, query: "battery life" },
    contextVersionIds: ["intent:v4", "truth:v2"],
    maxAttempts: 3,
    dependsOn: ["execution-only-dependency"],
  });
  assert.equal(reordered.taskFingerprint, base.taskFingerprint);
});

test("research task DAG rejects unknown dependencies, self-dependencies, and cycles", () => {
  const a = defineResearchTask({ runId: "run", planVersion: 1, normalizedInputs: { task: "a" } });
  const unknown = { ...a, taskFingerprint: "unknown-task", dependsOn: ["missing"] };
  assert.throws(() => assertResearchTaskGraph([unknown]), /Unknown research task dependency/);

  const self = { ...a, dependsOn: [a.taskFingerprint] };
  assert.throws(() => assertResearchTaskGraph([self]), /cannot depend on itself/);

  const b = defineResearchTask({ runId: "run", planVersion: 1, normalizedInputs: { task: "b" } });
  const cycleA = { ...a, dependsOn: [b.taskFingerprint] };
  const cycleB = { ...b, dependsOn: [a.taskFingerprint] };
  assert.throws(() => assertResearchTaskGraph([cycleA, cycleB]), /directed cycle/);
});

test("logical research scheduling is idempotent and dependencies release only after accepted predecessor result", async () => {
  const { runId, store } = await fixture();
  const first = defineResearchTask({
    runId,
    planVersion: 1,
    normalizedInputs: { purpose: "DISCONFIRM", claimId: "claim-a" },
    maxAttempts: 2,
  });
  const secondBase = defineResearchTask({
    runId,
    planVersion: 1,
    normalizedInputs: { purpose: "INDEPENDENT_CORROBORATION", claimId: "claim-a" },
  });
  const second = { ...secondBase, dependsOn: [first.taskFingerprint] };

  const scheduled = await store.scheduleResearchGraph({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    tasks: [first, second],
  });
  assert.equal(scheduled.outcome, "scheduled");
  if (scheduled.outcome !== "scheduled") return;
  const repeated = await store.scheduleResearchGraph({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    tasks: [first, second],
  });
  assert.equal(repeated.outcome, "scheduled");
  if (repeated.outcome !== "scheduled") return;
  assert.deepEqual(repeated.tasks.map((task) => task.id), scheduled.tasks.map((task) => task.id));

  const now = new Date("2026-08-26T12:00:00.000Z");
  const initialDispatch = await store.claimDispatches({
    queueName: "lattice.research",
    workerId: "dispatcher-a",
    now,
    leaseMs: 30_000,
    limit: 10,
  });
  assert.equal(initialDispatch.length, 1);
  assert.equal(initialDispatch[0]?.payload && (initialDispatch[0].payload as { taskId: string }).taskId, scheduled.tasks[0]?.id);
  await store.acknowledgeDispatch({ id: initialDispatch[0]!.id, workerId: "dispatcher-a", now });

  const firstClaim = await store.claimResearchTask({
    taskId: scheduled.tasks[0]!.id,
    workerId: "research-worker-a",
    now,
    leaseMs: 60_000,
  });
  assert.equal(firstClaim.outcome, "claimed");
  if (firstClaim.outcome !== "claimed") return;
  assert.equal((await store.claimResearchTask({
    taskId: scheduled.tasks[0]!.id,
    workerId: "research-worker-b",
    now,
    leaseMs: 60_000,
  })).outcome, "busy");

  const accepted = await store.completeResearchTask({
    taskId: firstClaim.task.id,
    workerId: "research-worker-a",
    attemptNumber: firstClaim.attempt.attemptNumber,
    result: { artifacts: [{ id: "candidate-source" }], authority: "UNTRUSTED" },
    now: new Date("2026-08-26T12:00:10.000Z"),
  });
  assert.equal(accepted.outcome, "accepted");

  const duplicate = await store.completeResearchTask({
    taskId: firstClaim.task.id,
    workerId: "research-worker-a",
    attemptNumber: firstClaim.attempt.attemptNumber,
    result: { artifacts: [{ id: "replacement" }] },
    now: new Date("2026-08-26T12:00:11.000Z"),
  });
  assert.deepEqual(duplicate, {
    outcome: "existing",
    result: { artifacts: [{ id: "candidate-source" }], authority: "UNTRUSTED" },
  });

  const dependentDispatch = await store.claimDispatches({
    queueName: "lattice.research",
    workerId: "dispatcher-b",
    now: new Date("2026-08-26T12:00:12.000Z"),
    leaseMs: 30_000,
    limit: 10,
  });
  assert.equal(dependentDispatch.length, 1);
  assert.equal((dependentDispatch[0]?.payload as { taskId: string }).taskId, scheduled.tasks[1]?.id);

  const wakeup = await store.claimDispatches({
    queueName: "lattice.orchestrate",
    workerId: "orchestrator",
    now: new Date("2026-08-26T12:00:12.000Z"),
    leaseMs: 30_000,
    limit: 10,
  });
  assert.equal(wakeup.length, 1);
  assert.equal((wakeup[0]?.payload as { taskId: string }).taskId, firstClaim.task.id);
});

test("failed attempts retry within bounds and exhausted work wakes the orchestrator", async () => {
  const { runId, store } = await fixture();
  const task = defineResearchTask({
    runId,
    planVersion: 1,
    normalizedInputs: { query: "retry-me" },
    maxAttempts: 2,
  });
  const scheduled = await store.scheduleResearchGraph({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    tasks: [task],
  });
  assert.equal(scheduled.outcome, "scheduled");
  if (scheduled.outcome !== "scheduled") return;
  const taskId = scheduled.tasks[0]!.id;
  const t0 = new Date("2026-08-26T12:00:00.000Z");
  const first = await store.claimResearchTask({ taskId, workerId: "w1", now: t0, leaseMs: 60_000 });
  assert.equal(first.outcome, "claimed");
  if (first.outcome !== "claimed") return;
  assert.equal((await store.failResearchTask({
    taskId,
    workerId: "w1",
    attemptNumber: first.attempt.attemptNumber,
    error: "transient",
    now: new Date("2026-08-26T12:00:01.000Z"),
  })).outcome, "retry_scheduled");

  const retryDispatch = await store.claimDispatches({
    queueName: "lattice.research",
    workerId: "dispatcher",
    now: new Date("2026-08-26T12:00:02.000Z"),
    leaseMs: 30_000,
    limit: 10,
  });
  assert.ok(retryDispatch.some((item) => (item.payload as { taskId: string }).taskId === taskId));

  const second = await store.claimResearchTask({
    taskId,
    workerId: "w2",
    now: new Date("2026-08-26T12:00:02.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(second.outcome, "claimed");
  if (second.outcome !== "claimed") return;
  assert.equal((await store.failResearchTask({
    taskId,
    workerId: "w2",
    attemptNumber: second.attempt.attemptNumber,
    error: "terminal",
    now: new Date("2026-08-26T12:00:03.000Z"),
  })).outcome, "exhausted");

  const wakeup = await store.claimDispatches({
    queueName: "lattice.orchestrate",
    workerId: "orchestrator",
    now: new Date("2026-08-26T12:00:04.000Z"),
    leaseMs: 30_000,
    limit: 10,
  });
  assert.equal(wakeup.length, 1);
});

test("outbox lease expiry permits redelivery but rejects the stale dispatcher acknowledgement", async () => {
  const { runId, store } = await fixture();
  const task = defineResearchTask({ runId, planVersion: 1, normalizedInputs: { query: "lease" } });
  await store.scheduleResearchGraph({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    tasks: [task],
  });
  const first = await store.claimDispatches({
    queueName: "lattice.research",
    workerId: "dispatcher-a",
    now: new Date("2026-08-26T12:00:00.000Z"),
    leaseMs: 1_000,
    limit: 1,
  });
  assert.equal(first.length, 1);
  assert.equal((await store.claimDispatches({
    queueName: "lattice.research",
    workerId: "dispatcher-b",
    now: new Date("2026-08-26T12:00:00.500Z"),
    leaseMs: 1_000,
    limit: 1,
  })).length, 0);
  const redelivered = await store.claimDispatches({
    queueName: "lattice.research",
    workerId: "dispatcher-b",
    now: new Date("2026-08-26T12:00:01.001Z"),
    leaseMs: 1_000,
    limit: 1,
  });
  assert.equal(redelivered.length, 1);
  assert.equal(redelivered[0]?.id, first[0]?.id);
  assert.equal(redelivered[0]?.deliveryAttempts, 2);
  assert.equal((await store.acknowledgeDispatch({
    id: first[0]!.id,
    workerId: "dispatcher-a",
    now: new Date("2026-08-26T12:00:01.100Z"),
  })).outcome, "stale");
  assert.equal((await store.acknowledgeDispatch({
    id: first[0]!.id,
    workerId: "dispatcher-b",
    now: new Date("2026-08-26T12:00:01.100Z"),
  })).outcome, "updated");
});

test("Run epoch movement invalidates pending research work", async () => {
  const { runId, runStore, store } = await fixture();
  const task = defineResearchTask({ runId, planVersion: 1, normalizedInputs: { query: "stale" } });
  const scheduled = await store.scheduleResearchGraph({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    tasks: [task],
  });
  assert.equal(scheduled.outcome, "scheduled");
  if (scheduled.outcome !== "scheduled") return;
  assert.deepEqual(await runStore.transition({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    nextStatus: "VALIDATING",
  }), { outcome: "advanced", version: 5 });
  assert.equal((await store.claimResearchTask({
    taskId: scheduled.tasks[0]!.id,
    workerId: "late-worker",
    now: new Date("2026-08-26T12:00:00.000Z"),
    leaseMs: 60_000,
  })).outcome, "stale");
});
