import assert from "node:assert/strict";
import test from "node:test";
import type { RunRequest } from "../src/domain.js";
import {
  defineResearchTask,
  MemoryOrchestrationStore,
  type RenewResearchTaskLeaseResult,
} from "../src/orchestration-store.js";
import { createPendingRun } from "../src/run-execution.js";
import { MemoryRunStore } from "../src/run-store.js";
import {
  processResearchDispatches,
  type ResearchTaskExecutionContext,
} from "../src/research-worker.js";

const request: RunRequest = {
  goal: "Exercise exact Research lease renewal.",
  hardConstraints: [],
  priorities: [],
};

const baseTime = Date.parse("2026-09-20T12:00:00.000Z");

function at(ms: number): Date {
  return new Date(baseTime + ms);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ManualLeaseRenewalWait {
  readonly delays: number[] = [];
  private waiting: (() => void) | undefined;
  private waitingObserved = deferred<void>();

  readonly wait = async (delayMs: number, signal: AbortSignal): Promise<void> => {
    this.delays.push(delayMs);
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", finish);
        if (this.waiting === finish) this.waiting = undefined;
        resolve();
      };
      this.waiting = finish;
      signal.addEventListener("abort", finish, { once: true });
      this.waitingObserved.resolve(undefined);
    });
  };

  async pulse(): Promise<void> {
    if (!this.waiting) await this.waitingObserved.promise;
    const waiting = this.waiting;
    assert.ok(waiting);
    this.waiting = undefined;
    this.waitingObserved = deferred<void>();
    waiting();
  }
}

class ObservedMemoryOrchestrationStore extends MemoryOrchestrationStore {
  readonly firstRenewal = deferred<RenewResearchTaskLeaseResult>();

  override async renewResearchTaskLease(
    input: Parameters<MemoryOrchestrationStore["renewResearchTaskLease"]>[0],
  ): Promise<RenewResearchTaskLeaseResult> {
    const result = await super.renewResearchTaskLease(input);
    this.firstRenewal.resolve(result);
    return result;
  }
}

class PersistenceCountingStore extends MemoryOrchestrationStore {
  completeCalls = 0;
  failCalls = 0;

  override async completeResearchTask(
    input: Parameters<MemoryOrchestrationStore["completeResearchTask"]>[0],
  ): ReturnType<MemoryOrchestrationStore["completeResearchTask"]> {
    this.completeCalls += 1;
    return await super.completeResearchTask(input);
  }

  override async failResearchTask(
    input: Parameters<MemoryOrchestrationStore["failResearchTask"]>[0],
  ): ReturnType<MemoryOrchestrationStore["failResearchTask"]> {
    this.failCalls += 1;
    return await super.failResearchTask(input);
  }
}

class ForcedStaleRenewalStore extends PersistenceCountingStore {
  override async renewResearchTaskLease(
    _input: Parameters<MemoryOrchestrationStore["renewResearchTaskLease"]>[0],
  ): Promise<RenewResearchTaskLeaseResult> {
    return { outcome: "stale" };
  }
}
 
async function scheduleOne(
  runStore: MemoryRunStore,
  store: MemoryOrchestrationStore,
  runId: Parameters<typeof createPendingRun>[2],
  maxAttempts = 1,
) {
  const run = createPendingRun(`lease-renewal-${runId}`, request, runId);
  await runStore.create(run);
  const definition = defineResearchTask({
    runId,
    planVersion: 1,
    normalizedInputs: { query: "long-running exact ownership" },
    maxAttempts,
  });
  const scheduled = await store.scheduleResearchGraph({
    runId,
    expectedStatus: "CREATED",
    expectedVersion: 1,
    tasks: [definition],
  });
  assert.equal(scheduled.outcome, "scheduled");
  if (scheduled.outcome !== "scheduled") throw new Error("Research task was not scheduled.");
  return scheduled.tasks[0]!;
}

test("Issue #131: maxAttempts=1 worker renews one exact attempt beyond the original lease and competing delivery stays busy", async () => {
  const runStore = new MemoryRunStore();
  const store = new ObservedMemoryOrchestrationStore(runStore);
  const runId = "00000000-0000-4000-8000-000000001731";
  const task = await scheduleOne(runStore, store, runId, 1);
  const wait = new ManualLeaseRenewalWait();
  const started = deferred<void>();
  const finish = deferred<unknown>();
  let elapsed = 0;
  let ownerExecutions = 0;
  let competingExecutions = 0;

  try {
    const owner = processResearchDispatches({
      orchestrationStore: store,
      executor: {
        async execute(context: ResearchTaskExecutionContext) {
          ownerExecutions += 1;
          assert.equal(context.signal.aborted, false);
          started.resolve(undefined);
          return await finish.promise;
        },
      },
      workerId: "research-owner",
      now: at(0),
      leaseMs: 100,
      retryDelayMs: 10,
      limit: 1,
      clock: () => at(elapsed),
      leaseRenewalWait: wait.wait,
    });

    await started.promise;
    elapsed = 60;
    await wait.pulse();
    assert.deepEqual(await store.firstRenewal.promise, {
      outcome: "renewed",
      leaseExpiresAt: at(160).toISOString(),
    });
    assert.ok(wait.delays[0] !== undefined && wait.delays[0] < 100);

    const renewed = await store.getResearchTask(task.id);
    assert.equal(renewed?.status, "RUNNING");
    assert.equal(renewed?.attemptCount, 1);
    assert.equal(renewed?.currentAttempt, 1);
    assert.equal(renewed?.leaseOwner, "research-owner");
    assert.equal(renewed?.leaseExpiresAt, at(160).toISOString());

    elapsed = 101;
    const competitor = await processResearchDispatches({
      orchestrationStore: store,
      executor: {
        async execute() {
          competingExecutions += 1;
          return { mustNotRun: true };
        },
      },
      workerId: "research-competitor",
      now: at(101),
      leaseMs: 100,
      retryDelayMs: 10,
      limit: 1,
      clock: () => at(elapsed),
    });
    assert.equal(competitor[0]?.outcome, "released");
    assert.equal(competingExecutions, 0);

    const stillOwned = await store.getResearchTask(task.id);
    assert.equal(stillOwned?.attemptCount, 1);
    assert.equal(stillOwned?.currentAttempt, 1);
    assert.equal(stillOwned?.leaseOwner, "research-owner");

    elapsed = 120;
    const acceptedResult = { artifacts: [], edges: [], evidence: [] };
    finish.resolve(acceptedResult);
    await owner;

    const completed = await store.getResearchTask(task.id);
    assert.equal(ownerExecutions, 1);
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(completed?.attemptCount, 1);
    assert.equal(completed?.currentAttempt, 1);
    assert.deepEqual(completed?.acceptedResult, acceptedResult);
  } finally {
    await store.close();
    await runStore.close();
  }
});

test("Issue #131: renewal rejects expired, wrong-worker, wrong-attempt, and no-longer-current ownership without resurrection", async () => {
  const runStore = new MemoryRunStore();
  const store = new MemoryOrchestrationStore(runStore);
  const runId = "00000000-0000-4000-8000-000000001732";
  const task = await scheduleOne(runStore, store, runId, 2);
  try {
    const first = await store.claimResearchTask({
      taskId: task.id,
      workerId: "worker-a",
      now: at(0),
      leaseMs: 100,
    });
    assert.equal(first.outcome, "claimed");
    if (first.outcome !== "claimed") return;

    assert.deepEqual(await store.renewResearchTaskLease({
      taskId: task.id,
      workerId: "wrong-worker",
      attemptNumber: 1,
      now: at(40),
      leaseMs: 100,
    }), { outcome: "stale" });
    assert.deepEqual(await store.renewResearchTaskLease({
      taskId: task.id,
      workerId: "worker-a",
      attemptNumber: 2,
      now: at(40),
      leaseMs: 100,
    }), { outcome: "stale" });

    assert.deepEqual(await store.renewResearchTaskLease({
      taskId: task.id,
      workerId: "worker-a",
      attemptNumber: 1,
      now: at(60),
      leaseMs: 100,
    }), {
      outcome: "renewed",
      leaseExpiresAt: at(160).toISOString(),
    });

    assert.deepEqual(await store.renewResearchTaskLease({
      taskId: task.id,
      workerId: "worker-a",
      attemptNumber: 1,
      now: at(160),
      leaseMs: 100,
    }), { outcome: "stale" });

    const reclaimed = await store.claimResearchTask({
      taskId: task.id,
      workerId: "worker-b",
      now: at(161),
      leaseMs: 100,
    });
    assert.equal(reclaimed.outcome, "claimed");
    if (reclaimed.outcome !== "claimed") return;
    assert.equal(reclaimed.attempt.attemptNumber, 2);

    assert.deepEqual(await store.renewResearchTaskLease({
      taskId: task.id,
      workerId: "worker-a",
      attemptNumber: 1,
      now: at(170),
      leaseMs: 100,
    }), { outcome: "stale" });

    const current = await store.getResearchTask(task.id);
    assert.equal(current?.currentAttempt, 2);
    assert.equal(current?.leaseOwner, "worker-b");
  } finally {
    await store.close();
    await runStore.close();
  }
});

test("Issue #131: Run epoch movement or terminal Run state makes exact-attempt renewal stale", async () => {
  for (const [runId, nextStatus] of [
    ["00000000-0000-4000-8000-000000001733", "UNDERSTANDING"],
    ["00000000-0000-4000-8000-000000001734", "CANCELLED"],
  ] as const) {
    const runStore = new MemoryRunStore();
    const store = new MemoryOrchestrationStore(runStore);
    const task = await scheduleOne(runStore, store, runId, 1);
    try {
      const claim = await store.claimResearchTask({
        taskId: task.id,
        workerId: "worker-run-bound",
        now: at(0),
        leaseMs: 100,
      });
      assert.equal(claim.outcome, "claimed");
      if (claim.outcome !== "claimed") continue;

      assert.deepEqual(await runStore.transition({
        runId,
        expectedStatus: "CREATED",
        expectedVersion: 1,
        nextStatus,
      }), { outcome: "advanced", version: 2 });

      assert.deepEqual(await store.renewResearchTaskLease({
        taskId: task.id,
        workerId: "worker-run-bound",
        attemptNumber: claim.attempt.attemptNumber,
        now: at(20),
        leaseMs: 100,
      }), { outcome: "stale" });
    } finally {
      await store.close();
      await runStore.close();
    }
  }
});

test("Issue #131: ownership-loss renewal aborts cooperative execution and never persists a late result or failure", { timeout: 2_000 }, async () => {
  const runStore = new MemoryRunStore();
  const store = new ForcedStaleRenewalStore(runStore);
  const runId = "00000000-0000-4000-8000-000000001735";
  const task = await scheduleOne(runStore, store, runId, 1);
  const wait = new ManualLeaseRenewalWait();
  const started = deferred<void>();
  const aborted = deferred<void>();
  let elapsed = 0;

  try {
    const worker = processResearchDispatches({
      orchestrationStore: store,
      executor: {
        async execute({ signal }) {
          started.resolve(undefined);
          signal.addEventListener("abort", () => aborted.resolve(undefined), { once: true });
          return await new Promise<never>(() => undefined);
        },
      },
      workerId: "losing-worker",
      now: at(0),
      leaseMs: 100,
      retryDelayMs: 10,
      limit: 1,
      clock: () => at(elapsed),
      leaseRenewalWait: wait.wait,
    });

    await started.promise;
    elapsed = 40;
    await wait.pulse();
    await aborted.promise;
    const outcomes = await worker;

    assert.equal(outcomes[0]?.outcome, "released");
    assert.equal(store.completeCalls, 0);
    assert.equal(store.failCalls, 0);
    const persisted = await store.getResearchTask(task.id);
    assert.equal(persisted?.status, "RUNNING");
    assert.equal(persisted?.attemptCount, 1);
    assert.equal(persisted?.currentAttempt, 1);
    assert.equal(persisted?.acceptedResult, null);
  } finally {
    await store.close();
    await runStore.close();
  }
});


test("Issue #131: actual Run epoch loss during execution aborts the owner and prevents result/failure persistence", { timeout: 2_000 }, async () => {
  const runStore = new MemoryRunStore();
  const store = new PersistenceCountingStore(runStore);
  const runId = "00000000-0000-4000-8000-000000001736";
  const task = await scheduleOne(runStore, store, runId, 1);
  const wait = new ManualLeaseRenewalWait();
  const started = deferred<void>();
  const aborted = deferred<void>();
  let elapsed = 0;

  try {
    const worker = processResearchDispatches({
      orchestrationStore: store,
      executor: {
        async execute({ signal }) {
          started.resolve(undefined);
          signal.addEventListener("abort", () => aborted.resolve(undefined), { once: true });
          return await new Promise<never>(() => undefined);
        },
      },
      workerId: "run-invalidated-worker",
      now: at(0),
      leaseMs: 100,
      retryDelayMs: 10,
      limit: 1,
      clock: () => at(elapsed),
      leaseRenewalWait: wait.wait,
    });

    await started.promise;
    assert.deepEqual(await runStore.transition({
      runId,
      expectedStatus: "CREATED",
      expectedVersion: 1,
      nextStatus: "UNDERSTANDING",
    }), { outcome: "advanced", version: 2 });

    elapsed = 40;
    await wait.pulse();
    await aborted.promise;
    const outcomes = await worker;

    assert.equal(outcomes[0]?.outcome, "released");
    assert.equal(store.completeCalls, 0);
    assert.equal(store.failCalls, 0);
    const persisted = await store.getResearchTask(task.id);
    assert.equal(persisted?.status, "RUNNING");
    assert.equal(persisted?.attemptCount, 1);
    assert.equal(persisted?.acceptedResult, null);
  } finally {
    await store.close();
    await runStore.close();
  }
});
