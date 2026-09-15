import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import {
  defineResearchTask,
  MemoryOrchestrationStore,
  type ClaimResearchTaskResult,
  type CompleteResearchTaskResult,
  type DispatchEnvelope,
  type DispatchMutationResult,
  type DurableOrchestrationStore,
  type DurableResearchTask,
  type FailResearchTaskResult,
  type ScheduleResearchGraphInput,
  type ScheduleResearchGraphResult,
} from "../src/orchestration-store.js";
import { processResearchDispatches } from "../src/research-worker.js";
import {
  createPendingRun,
  executePersistedRunTick,
  RunExecutionError,
} from "../src/run-execution.js";
import { processRunDispatches } from "../src/run-worker.js";
import type {
  RunCompletion,
  RunDecisionPersistence,
  RunStore,
  RunTransition,
  RunTransitionResult,
} from "../src/run-store.js";
import { MemoryRunStore } from "../src/run-store.js";
import type { TruthExecutionPipeline } from "../src/truth/execution-pipeline.js";
import type { TruthBundle } from "../src/truth/types.js";
import type { TruthSnapshot } from "../src/truth/snapshot.js";

const request: RunRequest = {
  goal: "Compare safe recovery options.",
  hardConstraints: [],
  priorities: [],
};

class EpochRaceRunStore implements RunStore {
  readonly kind = "memory" as const;
  run: LatticeRun = {
    ...createPendingRun("epoch-race", request, "run-epoch-race"),
    status: "INVESTIGATING",
    version: 4,
    events: [
      { sequence: 1, type: "CREATED" },
      { sequence: 2, type: "UNDERSTANDING" },
      { sequence: 3, type: "PLANNING" },
      { sequence: 4, type: "INVESTIGATING" },
    ],
  };

  async create(run: LatticeRun): Promise<void> { this.run = structuredClone(run); }
  async transition(input: RunTransition): Promise<RunTransitionResult> {
    if (this.run.status !== input.expectedStatus || this.run.version !== input.expectedVersion) {
      return { outcome: "stale" };
    }
    this.run = {
      ...this.run,
      status: input.nextStatus,
      version: this.run.version + 1,
      events: [...this.run.events, { sequence: this.run.events.length + 1, type: input.nextStatus }],
    };
    return { outcome: "advanced", version: this.run.version };
  }
  async persistDecision(_input: RunDecisionPersistence): Promise<RunTransitionResult> { throw new Error("unused"); }
  async complete(_input: RunCompletion): Promise<RunTransitionResult> { throw new Error("unused"); }
  async get(runId: string): Promise<LatticeRun | undefined> {
    return runId === this.run.id ? structuredClone(this.run) : undefined;
  }
  async getTruthSnapshot(_runId: string): Promise<TruthSnapshot | undefined> { return undefined; }
  async getTruthBundle(_runId: string): Promise<TruthBundle | undefined> { return undefined; }
  async close(): Promise<void> {}
}

function throwingInvestigationPipeline(store: EpochRaceRunStore): TruthExecutionPipeline {
  return {
    mode: "v36-offline-fixture",
    async investigate() {
      store.run = {
        ...store.run,
        status: "VALIDATING",
        version: 5,
        events: [...store.run.events, { sequence: store.run.events.length + 1, type: "VALIDATING" }],
      };
      throw new Error("slow worker failed after losing epoch");
    },
    async validate() { throw new Error("unused"); },
    async execute() { throw new Error("unused"); },
  };
}

test("stale Run executor cannot fail a newer epoch after its slow operation throws", async () => {
  const store = new EpochRaceRunStore();
  await assert.rejects(
    executePersistedRunTick(store, throwingInvestigationPipeline(store), store.run.id),
    (error: unknown) => error instanceof RunExecutionError && error.retryable,
  );
  const current = await store.get(store.run.id);
  assert.equal(current?.status, "VALIDATING");
  assert.equal(current?.version, 5);
});

test("a genuine error still fails the exact Run epoch while ownership remains current", async () => {
  const store = new EpochRaceRunStore();
  const pipeline: TruthExecutionPipeline = {
    mode: "v36-offline-fixture",
    async investigate() { throw new Error("owned failure"); },
    async validate() { throw new Error("unused"); },
    async execute() { throw new Error("unused"); },
  };
  await assert.rejects(
    executePersistedRunTick(store, pipeline, store.run.id),
    (error: unknown) => error instanceof RunExecutionError && !error.retryable && error.message === "owned failure",
  );
  const current = await store.get(store.run.id);
  assert.equal(current?.status, "FAILED");
  assert.equal(current?.version, 5);
});

function at(ms: number): Date {
  return new Date(`2026-01-01T00:00:00.${String(ms).padStart(3, "0")}Z`);
}

test("expired research and dispatch leases cannot mutate newer ownership", async () => {
  const runStore = new MemoryRunStore();
  const run = createPendingRun("lease-guard", request, "run-lease-guard");
  await runStore.create(run);
  const store = new MemoryOrchestrationStore(runStore);
  try {
    const definition = defineResearchTask({
      runId: run.id,
      planVersion: 1,
      normalizedInputs: { query: "lease ownership" },
      maxAttempts: 2,
    });
    const scheduled = await store.scheduleResearchGraph({
      runId: run.id,
      expectedStatus: "CREATED",
      expectedVersion: 1,
      tasks: [definition],
    });
    assert.equal(scheduled.outcome, "scheduled");
    if (scheduled.outcome !== "scheduled") return;
    const task = scheduled.tasks[0]!;

    const firstDispatch = (await store.claimDispatches({
      queueName: "lattice.research",
      workerId: "worker-a",
      now: at(0),
      leaseMs: 100,
      limit: 1,
    }))[0]!;
    const firstAttempt = await store.claimResearchTask({
      taskId: task.id,
      workerId: "worker-a",
      now: at(0),
      leaseMs: 100,
    });
    assert.equal(firstAttempt.outcome, "claimed");
    if (firstAttempt.outcome !== "claimed") return;

    assert.deepEqual(await store.failResearchTask({
      taskId: task.id,
      workerId: "worker-a",
      attemptNumber: firstAttempt.attempt.attemptNumber,
      error: "expired",
      now: at(100),
    }), { outcome: "stale" });
    assert.deepEqual(await store.acknowledgeDispatch({
      id: firstDispatch.id,
      workerId: "worker-a",
      now: at(100),
    }), { outcome: "stale" });
    assert.deepEqual(await store.releaseDispatch({
      id: firstDispatch.id,
      workerId: "worker-a",
      now: at(100),
      availableAt: at(101),
    }), { outcome: "stale" });

    const reclaimedTask = await store.claimResearchTask({
      taskId: task.id,
      workerId: "worker-b",
      now: at(101),
      leaseMs: 100,
    });
    assert.equal(reclaimedTask.outcome, "claimed");
    if (reclaimedTask.outcome !== "claimed") return;
    assert.equal(reclaimedTask.attempt.attemptNumber, 2);

    assert.deepEqual(await store.completeResearchTask({
      taskId: task.id,
      workerId: "worker-a",
      attemptNumber: firstAttempt.attempt.attemptNumber,
      result: { stale: true },
      now: at(102),
    }), { outcome: "stale" });
    const current = await store.getResearchTask(task.id);
    assert.equal(current?.status, "RUNNING");
    assert.equal(current?.currentAttempt, 2);
    assert.equal(current?.leaseOwner, "worker-b");
  } finally {
    await store.close();
    await runStore.close();
  }
});

class ClaimRecordingOrchestrationStore implements DurableOrchestrationStore {
  readonly claimTimes: Date[] = [];
  readonly taskClaimTimes: Date[] = [];
  private runDispatches: DispatchEnvelope[];
  private researchDispatches: DispatchEnvelope[];
  private readonly task: DurableResearchTask;

  constructor() {
    this.runDispatches = [1, 2].map((id) => ({
      id,
      logicalKey: `run-${id}`,
      runId: `terminal-${id}`,
      queueName: "lattice.run",
      payload: {},
      availableAt: at(0).toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      deliveryAttempts: 0,
      dispatchedAt: null,
    }));
    this.task = {
      id: "research-task",
      runId: "research-run",
      taskFingerprint: "fingerprint",
      planVersion: 1,
      taskType: "RESEARCH",
      input: {},
      contextVersionIds: [],
      dependsOn: [],
      runEpoch: 1,
      status: "SUCCEEDED",
      maxAttempts: 1,
      attemptCount: 1,
      currentAttempt: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      acceptedResult: { existing: true },
    };
    this.researchDispatches = [{
      id: 3,
      logicalKey: "research-1",
      runId: this.task.runId,
      queueName: "lattice.research",
      payload: { taskId: this.task.id, taskFingerprint: this.task.taskFingerprint, runEpoch: this.task.runEpoch },
      availableAt: at(0).toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      deliveryAttempts: 0,
      dispatchedAt: null,
    }];
  }

  async scheduleResearchGraph(_input: ScheduleResearchGraphInput): Promise<ScheduleResearchGraphResult> { throw new Error("unused"); }
  async getResearchTask(taskId: string): Promise<DurableResearchTask | undefined> {
    return taskId === this.task.id ? structuredClone(this.task) : undefined;
  }
  async claimResearchTask(input: { taskId: string; workerId: string; now: Date; leaseMs: number }): Promise<ClaimResearchTaskResult> {
    this.taskClaimTimes.push(input.now);
    return { outcome: "completed", result: { existing: true } };
  }
  async completeResearchTask(): Promise<CompleteResearchTaskResult> { throw new Error("unused"); }
  async failResearchTask(): Promise<FailResearchTaskResult> { throw new Error("unused"); }
  async claimDispatches(input: { queueName: string; workerId: string; now: Date; leaseMs: number; limit: number }): Promise<DispatchEnvelope[]> {
    assert.equal(input.limit, 1);
    this.claimTimes.push(input.now);
    const queue = input.queueName === "lattice.run" ? this.runDispatches : this.researchDispatches;
    const item = queue.shift();
    return item ? [{ ...item, leaseOwner: input.workerId, leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString() }] : [];
  }
  async acknowledgeDispatch(): Promise<DispatchMutationResult> { return { outcome: "updated" }; }
  async releaseDispatch(): Promise<DispatchMutationResult> { return { outcome: "updated" }; }
  async close(): Promise<void> {}
}

class TerminalRunStore implements RunStore {
  readonly kind = "memory" as const;
  async create(): Promise<void> { throw new Error("unused"); }
  async transition(): Promise<RunTransitionResult> { throw new Error("unused"); }
  async persistDecision(): Promise<RunTransitionResult> { throw new Error("unused"); }
  async complete(): Promise<RunTransitionResult> { throw new Error("unused"); }
  async get(runId: string): Promise<LatticeRun | undefined> {
    return {
      ...createPendingRun("dispatch-fresh-time", request, runId),
      status: "COMPLETED",
      version: 8,
    };
  }
  async getTruthSnapshot(): Promise<TruthSnapshot | undefined> { return undefined; }
  async getTruthBundle(): Promise<TruthBundle | undefined> { return undefined; }
  async close(): Promise<void> {}
}

test("workers claim one item immediately before execution using fresh time", async () => {
  const orchestration = new ClaimRecordingOrchestrationStore();
  const clockValues = [at(0), at(10), at(200), at(210), at(400), at(410), at(420)];
  const clock = () => clockValues.shift() ?? at(999);
  const dummyPipeline: TruthExecutionPipeline = {
    mode: "v36-offline-fixture",
    async investigate() { throw new Error("unused"); },
    async validate() { throw new Error("unused"); },
    async execute() { throw new Error("unused"); },
  };

  const runOutcomes = await processRunDispatches({
    runStore: new TerminalRunStore(),
    orchestrationStore: orchestration,
    truthPipeline: dummyPipeline,
    workerId: "run-worker",
    now: at(0),
    leaseMs: 100,
    limit: 2,
    clock,
  });
  assert.equal(runOutcomes.length, 2);
  assert.deepEqual(orchestration.claimTimes.slice(0, 2), [at(0), at(200)]);

  const researchOutcomes = await processResearchDispatches({
    orchestrationStore: orchestration,
    executor: { async execute() { throw new Error("unused"); } },
    workerId: "research-worker",
    now: at(0),
    leaseMs: 100,
    limit: 1,
    clock,
  });
  assert.equal(researchOutcomes[0]?.outcome, "existing");
  assert.deepEqual(orchestration.taskClaimTimes, [at(410)]);
});
