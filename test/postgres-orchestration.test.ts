import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import { defineResearchTask } from "../src/orchestration-store.js";
import { PostgresOrchestrationStore } from "../src/postgres-orchestration-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";

const databaseUrl = process.env.DATABASE_URL;
const request: RunRequest = {
  goal: "Exercise PostgreSQL research orchestration.",
  hardConstraints: [],
  priorities: [],
};

function investigatingRun(id: string): LatticeRun {
  return {
    id,
    conversationId: `pg-orchestration-${id}`,
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

test(
  "PostgreSQL persists idempotent research DAGs, attempts, immutable accepted results, and dependent wakeups across reconnect",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    let orchestration: PostgresOrchestrationStore | undefined;
    try {
      await runStore.create(investigatingRun(runId));
      orchestration = await PostgresOrchestrationStore.connect(databaseUrl);
      const first = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { purpose: "DISCONFIRM", claimId: "claim-pg" },
        maxAttempts: 2,
      });
      const secondBase = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { purpose: "INDEPENDENT_CORROBORATION", claimId: "claim-pg" },
      });
      const second = { ...secondBase, dependsOn: [first.taskFingerprint] };

      const scheduled = await orchestration.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [first, second],
      });
      assert.equal(scheduled.outcome, "scheduled");
      if (scheduled.outcome !== "scheduled") return;
      const repeated = await orchestration.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [first, second],
      });
      assert.equal(repeated.outcome, "scheduled");
      if (repeated.outcome !== "scheduled") return;
      assert.deepEqual(repeated.tasks.map((task) => task.id), scheduled.tasks.map((task) => task.id));

      const counts = await pool.query<{ tasks: string; dependencies: string; ready_dispatches: string }>(
        `SELECT
           (SELECT count(*)::text FROM run_tasks WHERE run_id=$1) AS tasks,
           (SELECT count(*)::text FROM run_task_dependencies WHERE run_id=$1) AS dependencies,
           (SELECT count(*)::text FROM dispatch_outbox WHERE run_id=$1 AND queue_name='lattice.research') AS ready_dispatches`,
        [runId],
      );
      assert.deepEqual(counts.rows[0], { tasks: "2", dependencies: "1", ready_dispatches: "1" });

      const now = new Date("2026-08-26T12:00:00.000Z");
      const dispatch = await orchestration.claimDispatches({
        queueName: "lattice.research",
        workerId: "dispatcher-pg",
        now,
        leaseMs: 30_000,
        limit: 10,
      });
      assert.equal(dispatch.length, 1);
      await orchestration.acknowledgeDispatch({ id: dispatch[0]!.id, workerId: "dispatcher-pg", now });

      const claim = await orchestration.claimResearchTask({
        taskId: scheduled.tasks[0]!.id,
        workerId: "research-pg",
        now,
        leaseMs: 60_000,
      });
      assert.equal(claim.outcome, "claimed");
      if (claim.outcome !== "claimed") return;
      const result = { artifacts: [{ id: "pg-source" }], sourceAuthority: "UNTRUSTED" };
      assert.deepEqual(await orchestration.completeResearchTask({
        taskId: claim.task.id,
        workerId: "research-pg",
        attemptNumber: claim.attempt.attemptNumber,
        result,
        now: new Date("2026-08-26T12:00:10.000Z"),
      }), { outcome: "accepted", result });
      assert.deepEqual(await orchestration.completeResearchTask({
        taskId: claim.task.id,
        workerId: "research-pg",
        attemptNumber: claim.attempt.attemptNumber,
        result: { artifacts: [{ id: "replacement" }] },
        now: new Date("2026-08-26T12:00:11.000Z"),
      }), { outcome: "existing", result });

      await orchestration.close();
      orchestration = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
      const reloaded = await orchestration.getResearchTask(claim.task.id);
      assert.ok(reloaded);
      assert.equal(reloaded.status, "SUCCEEDED");
      assert.deepEqual(reloaded.acceptedResult, result);

      const dependent = await orchestration.claimDispatches({
        queueName: "lattice.research",
        workerId: "dispatcher-dependent",
        now: new Date("2026-08-26T12:00:12.000Z"),
        leaseMs: 30_000,
        limit: 10,
      });
      assert.equal(dependent.length, 1);
      assert.equal((dependent[0]?.payload as { taskId: string }).taskId, scheduled.tasks[1]!.id);
      const wakeup = await orchestration.claimDispatches({
        queueName: "lattice.orchestrate",
        workerId: "orchestrator-pg",
        now: new Date("2026-08-26T12:00:12.000Z"),
        leaseMs: 30_000,
        limit: 10,
      });
      assert.equal(wakeup.length, 1);
      assert.equal((wakeup[0]?.payload as { taskId: string }).taskId, claim.task.id);

      const attempts = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM run_task_attempts WHERE task_id=$1",
        [claim.task.id],
      );
      assert.equal(attempts.rows[0]?.count, "1");
    } finally {
      if (orchestration) await orchestration.close();
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await runStore.close();
    }
  },
);

test(
  "PostgreSQL rejects late research completion after Run epoch movement without accepted-result or wakeup side effects",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const orchestration = await PostgresOrchestrationStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runStore.create(investigatingRun(runId));
      const definition = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { query: "late-provider-result" },
      });
      const scheduled = await orchestration.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [definition],
      });
      assert.equal(scheduled.outcome, "scheduled");
      if (scheduled.outcome !== "scheduled") return;
      const taskId = scheduled.tasks[0]!.id;
      const claim = await orchestration.claimResearchTask({
        taskId,
        workerId: "late-worker",
        now: new Date("2026-08-26T12:00:00.000Z"),
        leaseMs: 60_000,
      });
      assert.equal(claim.outcome, "claimed");
      if (claim.outcome !== "claimed") return;

      assert.deepEqual(await runStore.transition({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        nextStatus: "VALIDATING",
      }), { outcome: "advanced", version: 5 });
      assert.equal((await orchestration.completeResearchTask({
        taskId,
        workerId: "late-worker",
        attemptNumber: claim.attempt.attemptNumber,
        result: { shouldNotBecomeAccepted: true },
        now: new Date("2026-08-26T12:00:01.000Z"),
      })).outcome, "stale");

      const persisted = await orchestration.getResearchTask(taskId);
      assert.ok(persisted);
      assert.equal(persisted.acceptedResult, null);
      const wakeups = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM dispatch_outbox
         WHERE run_id=$1 AND logical_key=$2`,
        [runId, `orchestrator:research-task:${taskId}:accepted`],
      );
      assert.equal(wakeups.rows[0]?.count, "0");
    } finally {
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await orchestration.close();
      await runStore.close();
    }
  },
);

test(
  "PostgreSQL outbox leases redeliver after expiry and stale dispatchers cannot acknowledge the new lease",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const orchestration = await PostgresOrchestrationStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await runStore.create(investigatingRun(runId));
      const definition = defineResearchTask({ runId, planVersion: 1, normalizedInputs: { query: "outbox" } });
      await orchestration.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [definition],
      });
      const first = await orchestration.claimDispatches({
        queueName: "lattice.research",
        workerId: "dispatcher-a",
        now: new Date("2026-08-26T12:00:00.000Z"),
        leaseMs: 1_000,
        limit: 1,
      });
      assert.equal(first.length, 1);
      assert.equal((await orchestration.claimDispatches({
        queueName: "lattice.research",
        workerId: "dispatcher-b",
        now: new Date("2026-08-26T12:00:00.500Z"),
        leaseMs: 1_000,
        limit: 1,
      })).length, 0);
      const second = await orchestration.claimDispatches({
        queueName: "lattice.research",
        workerId: "dispatcher-b",
        now: new Date("2026-08-26T12:00:01.001Z"),
        leaseMs: 1_000,
        limit: 1,
      });
      assert.equal(second.length, 1);
      assert.equal(second[0]?.id, first[0]?.id);
      assert.equal(second[0]?.deliveryAttempts, 2);
      assert.equal((await orchestration.acknowledgeDispatch({
        id: first[0]!.id,
        workerId: "dispatcher-a",
        now: new Date("2026-08-26T12:00:01.100Z"),
      })).outcome, "stale");
      assert.equal((await orchestration.acknowledgeDispatch({
        id: first[0]!.id,
        workerId: "dispatcher-b",
        now: new Date("2026-08-26T12:00:01.100Z"),
      })).outcome, "updated");
    } finally {
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await orchestration.close();
      await runStore.close();
    }
  },
);
