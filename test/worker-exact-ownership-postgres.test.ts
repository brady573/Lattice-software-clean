import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import { defineResearchTask } from "../src/orchestration-store.js";
import { PostgresOrchestrationStore } from "../src/postgres-orchestration-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { executePersistedRunTick, RunExecutionError } from "../src/run-execution.js";
import type { TruthExecutionPipeline } from "../src/truth/execution-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;
const request: RunRequest = {
  goal: "Prove exact durable worker ownership.",
  hardConstraints: [],
  priorities: [],
};
const BASE_TIME = Date.parse("2026-09-15T12:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(BASE_TIME + offsetMs);
}

function investigatingRun(id: string): LatticeRun {
  return {
    id,
    conversationId: `worker-exact-ownership-${id}`,
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

async function deleteRuns(pool: Pool, runIds: readonly string[]): Promise<void> {
  for (const runId of runIds) {
    await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
  }
}

test(
  "PostgreSQL stale Run failure cannot overwrite a newer epoch while a genuine owned failure still succeeds",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const staleRunId = randomUUID();
    const ownedRunId = randomUUID();
    const workerA = await PostgresRunStore.connect(databaseUrl);
    const workerB = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await workerA.create(investigatingRun(staleRunId));
      const stalePipeline: TruthExecutionPipeline = {
        mode: "v36-offline-fixture",
        async investigate() {
          assert.deepEqual(await workerB.transition({
            runId: staleRunId,
            expectedStatus: "INVESTIGATING",
            expectedVersion: 4,
            nextStatus: "VALIDATING",
          }), { outcome: "advanced", version: 5 });
          throw new Error("slow worker failed after losing Run epoch");
        },
        async validate() { throw new Error("unused"); },
        async execute() { throw new Error("unused"); },
      };

      await assert.rejects(
        executePersistedRunTick(workerA, stalePipeline, staleRunId),
        (error: unknown) => error instanceof RunExecutionError && error.retryable,
      );
      const authoritative = await workerB.get(staleRunId);
      assert.equal(authoritative?.status, "VALIDATING");
      assert.equal(authoritative?.version, 5);

      await workerA.create(investigatingRun(ownedRunId));
      const ownedFailurePipeline: TruthExecutionPipeline = {
        mode: "v36-offline-fixture",
        async investigate() { throw new Error("owned PostgreSQL failure"); },
        async validate() { throw new Error("unused"); },
        async execute() { throw new Error("unused"); },
      };
      await assert.rejects(
        executePersistedRunTick(workerA, ownedFailurePipeline, ownedRunId),
        (error: unknown) => error instanceof RunExecutionError
          && !error.retryable
          && error.message === "owned PostgreSQL failure",
      );
      const failed = await workerB.get(ownedRunId);
      assert.equal(failed?.status, "FAILED");
      assert.equal(failed?.version, 5);
    } finally {
      await deleteRuns(pool, [staleRunId, ownedRunId]);
      await pool.end();
      await workerB.close();
      await workerA.close();
    }
  },
);

test(
  "PostgreSQL accepts exactly one concurrent Run mutation for one exact epoch",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const workerA = await PostgresRunStore.connect(databaseUrl);
    const workerB = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await workerA.create(investigatingRun(runId));
      const outcomes = await Promise.all([
        workerA.transition({
          runId,
          expectedStatus: "INVESTIGATING",
          expectedVersion: 4,
          nextStatus: "VALIDATING",
        }),
        workerB.transition({
          runId,
          expectedStatus: "INVESTIGATING",
          expectedVersion: 4,
          nextStatus: "FAILED",
        }),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.outcome === "advanced").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.outcome === "stale").length, 1);
      const authoritative = await workerA.get(runId);
      assert.equal(authoritative?.version, 5);
      assert.ok(authoritative?.status === "VALIDATING" || authoritative?.status === "FAILED");
    } finally {
      await deleteRuns(pool, [runId]);
      await pool.end();
      await workerB.close();
      await workerA.close();
    }
  },
);

test(
  "PostgreSQL reclaimed research attempt rejects stale completion/failure and preserves exact retry exhaustion",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const workerA = await PostgresOrchestrationStore.connect(databaseUrl);
    const workerB = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runStore.create(investigatingRun(runId));
      const definition = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { query: "exact research attempt ownership" },
        maxAttempts: 3,
      });
      const scheduled = await workerA.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [definition],
      });
      assert.equal(scheduled.outcome, "scheduled");
      if (scheduled.outcome !== "scheduled") return;
      const taskId = scheduled.tasks[0]!.id;

      const first = await workerA.claimResearchTask({
        taskId,
        workerId: "research-worker-a",
        now: at(0),
        leaseMs: 100,
      });
      assert.equal(first.outcome, "claimed");
      if (first.outcome !== "claimed") return;
      assert.equal(first.attempt.attemptNumber, 1);

      const reclaimed = await workerB.claimResearchTask({
        taskId,
        workerId: "research-worker-b",
        now: at(101),
        leaseMs: 100,
      });
      assert.equal(reclaimed.outcome, "claimed");
      if (reclaimed.outcome !== "claimed") return;
      assert.equal(reclaimed.attempt.attemptNumber, 2);

      assert.deepEqual(await workerA.completeResearchTask({
        taskId,
        workerId: "research-worker-a",
        attemptNumber: first.attempt.attemptNumber,
        result: { stale: "completion" },
        now: at(102),
      }), { outcome: "stale" });
      assert.deepEqual(await workerA.failResearchTask({
        taskId,
        workerId: "research-worker-a",
        attemptNumber: first.attempt.attemptNumber,
        error: "stale expired failure",
        now: at(102),
      }), { outcome: "stale" });

      const afterStale = await workerB.getResearchTask(taskId);
      assert.equal(afterStale?.status, "RUNNING");
      assert.equal(afterStale?.attemptCount, 2);
      assert.equal(afterStale?.currentAttempt, 2);
      assert.equal(afterStale?.leaseOwner, "research-worker-b");

      assert.deepEqual(await workerB.failResearchTask({
        taskId,
        workerId: "research-worker-b",
        attemptNumber: reclaimed.attempt.attemptNumber,
        error: "legitimate retryable failure",
        now: at(150),
        retryAt: at(151),
      }), { outcome: "retry_scheduled" });
      const afterCurrentFailure = await workerA.getResearchTask(taskId);
      assert.equal(afterCurrentFailure?.status, "PENDING");
      assert.equal(afterCurrentFailure?.attemptCount, 2);

      const finalAttempt = await workerA.claimResearchTask({
        taskId,
        workerId: "research-worker-c",
        now: at(151),
        leaseMs: 100,
      });
      assert.equal(finalAttempt.outcome, "claimed");
      if (finalAttempt.outcome !== "claimed") return;
      assert.equal(finalAttempt.attempt.attemptNumber, 3);

      assert.deepEqual(await workerA.failResearchTask({
        taskId,
        workerId: "research-worker-c",
        attemptNumber: finalAttempt.attempt.attemptNumber,
        error: "final legitimate failure",
        now: at(160),
      }), { outcome: "exhausted" });

      const exhausted = await workerB.getResearchTask(taskId);
      assert.equal(exhausted?.status, "FAILED");
      assert.equal(exhausted?.attemptCount, 3);
      assert.equal(exhausted?.currentAttempt, 3);
      assert.equal(exhausted?.leaseOwner, null);
      assert.equal(exhausted?.leaseExpiresAt, null);

      const attempts = await pool.query<{ attempt_number: number; worker_id: string; status: string }>(
        `SELECT attempt_number,worker_id,status
         FROM run_task_attempts
         WHERE task_id=$1
         ORDER BY attempt_number`,
        [taskId],
      );
      assert.deepEqual(attempts.rows, [
        { attempt_number: 1, worker_id: "research-worker-a", status: "STALE" },
        { attempt_number: 2, worker_id: "research-worker-b", status: "FAILED" },
        { attempt_number: 3, worker_id: "research-worker-c", status: "FAILED" },
      ]);
    } finally {
      await deleteRuns(pool, [runId]);
      await pool.end();
      await workerB.close();
      await workerA.close();
      await runStore.close();
    }
  },
);

test(
  "PostgreSQL accepts one concurrent research completion for the exact current attempt",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const workerA = await PostgresOrchestrationStore.connect(databaseUrl);
    const workerB = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runStore.create(investigatingRun(runId));
      const definition = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { query: "concurrent accepted result" },
        maxAttempts: 1,
      });
      const scheduled = await workerA.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [definition],
      });
      assert.equal(scheduled.outcome, "scheduled");
      if (scheduled.outcome !== "scheduled") return;
      const taskId = scheduled.tasks[0]!.id;
      const claim = await workerA.claimResearchTask({
        taskId,
        workerId: "research-owner",
        now: at(0),
        leaseMs: 1_000,
      });
      assert.equal(claim.outcome, "claimed");
      if (claim.outcome !== "claimed") return;

      const candidates = [{ result: { source: "left" } }, { result: { source: "right" } }] as const;
      const outcomes = await Promise.all(candidates.map(({ result }, index) => (
        (index === 0 ? workerA : workerB).completeResearchTask({
          taskId,
          workerId: "research-owner",
          attemptNumber: claim.attempt.attemptNumber,
          result,
          now: at(10),
        })
      )));
      assert.equal(outcomes.filter((outcome) => outcome.outcome === "accepted").length, 1);
      assert.equal(outcomes.filter((outcome) => outcome.outcome === "existing").length, 1);
      const acceptedIndex = outcomes.findIndex((outcome) => outcome.outcome === "accepted");
      assert.ok(acceptedIndex >= 0);
      const persisted = await workerA.getResearchTask(taskId);
      assert.equal(persisted?.status, "SUCCEEDED");
      assert.deepEqual(persisted?.acceptedResult, candidates[acceptedIndex]!.result);

      const attempts = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM run_task_attempts WHERE task_id=$1 AND status='SUCCEEDED'",
        [taskId],
      );
      assert.equal(attempts.rows[0]?.count, "1");
    } finally {
      await deleteRuns(pool, [runId]);
      await pool.end();
      await workerB.close();
      await workerA.close();
      await runStore.close();
    }
  },
);

test(
  "PostgreSQL reclaimed dispatch rejects stale acknowledge/release and permits one exact current-lease mutation",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const workerA = await PostgresOrchestrationStore.connect(databaseUrl);
    const workerB = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runStore.create(investigatingRun(runId));
      const definition = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { query: "dispatch lease ownership" },
      });
      const scheduled = await workerA.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [definition],
      });
      assert.equal(scheduled.outcome, "scheduled");

      const first = await workerA.claimDispatches({
        queueName: "lattice.research",
        workerId: "dispatch-worker-a",
        now: at(0),
        leaseMs: 100,
        limit: 1,
      });
      assert.equal(first.length, 1);
      const reclaimed = await workerB.claimDispatches({
        queueName: "lattice.research",
        workerId: "dispatch-worker-b",
        now: at(101),
        leaseMs: 100,
        limit: 1,
      });
      assert.equal(reclaimed.length, 1);
      assert.equal(reclaimed[0]?.id, first[0]?.id);
      assert.equal(reclaimed[0]?.deliveryAttempts, 2);

      assert.deepEqual(await workerA.acknowledgeDispatch({
        id: first[0]!.id,
        workerId: "dispatch-worker-a",
        now: at(102),
      }), { outcome: "stale" });
      assert.deepEqual(await workerA.releaseDispatch({
        id: first[0]!.id,
        workerId: "dispatch-worker-a",
        now: at(102),
        availableAt: at(200),
      }), { outcome: "stale" });

      const currentMutations = await Promise.all([
        workerA.acknowledgeDispatch({
          id: reclaimed[0]!.id,
          workerId: "dispatch-worker-b",
          now: at(103),
        }),
        workerB.releaseDispatch({
          id: reclaimed[0]!.id,
          workerId: "dispatch-worker-b",
          now: at(103),
          availableAt: at(200),
        }),
      ]);
      assert.equal(currentMutations.filter((result) => result.outcome === "updated").length, 1);
      assert.equal(currentMutations.filter((result) => result.outcome === "stale").length, 1);

      const persisted = await pool.query<{
        lease_owner: string | null;
        lease_expires_at: Date | null;
        dispatched_at: Date | null;
        delivery_attempts: number;
      }>(
        `SELECT lease_owner,lease_expires_at,dispatched_at,delivery_attempts
         FROM dispatch_outbox WHERE id=$1`,
        [reclaimed[0]!.id],
      );
      assert.equal(persisted.rows[0]?.lease_owner, null);
      assert.equal(persisted.rows[0]?.lease_expires_at, null);
      assert.equal(persisted.rows[0]?.delivery_attempts, 2);
    } finally {
      await deleteRuns(pool, [runId]);
      await pool.end();
      await workerB.close();
      await workerA.close();
      await runStore.close();
    }
  },
);
