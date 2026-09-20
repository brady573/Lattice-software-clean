import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import { defineResearchTask } from "../src/orchestration-store.js";
import { PostgresOrchestrationStore } from "../src/postgres-orchestration-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { processResearchDispatches } from "../src/research-worker.js";

const databaseUrl = process.env.DATABASE_URL;
const baseTime = Date.parse("2026-09-20T13:00:00.000Z");
const request: RunRequest = {
  goal: "Exercise PostgreSQL exact Research lease renewal.",
  hardConstraints: [],
  priorities: [],
};

function at(ms: number): Date {
  return new Date(baseTime + ms);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class ManualLeaseRenewalWait {
  private waiting: (() => void) | undefined;
  private waitingObserved = deferred<void>();

  readonly wait = async (_delayMs: number, signal: AbortSignal): Promise<void> => {
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

function investigatingRun(id: string): LatticeRun {
  return {
    id,
    conversationId: `issue-131-${id}`,
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
  "Issue #131 PostgreSQL: renewed maxAttempts=1 worker keeps one RUNNING attempt, blocks a competitor, and completes exactly once",
  { skip: !databaseUrl, timeout: 10_000 },
  async () => {
    assert.ok(databaseUrl);
    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const ownerStore = await PostgresOrchestrationStore.connect(databaseUrl);
    const competitorStore = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    const wait = new ManualLeaseRenewalWait();
    const started = deferred<void>();
    const finish = deferred<unknown>();
    let elapsed = 0;
    let ownerExecutions = 0;
    let competitorExecutions = 0;

    try {
      await runStore.create(investigatingRun(runId));
      const definition = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { query: "PostgreSQL long-running exact ownership" },
        maxAttempts: 1,
      });
      const scheduled = await ownerStore.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [definition],
      });
      assert.equal(scheduled.outcome, "scheduled");
      if (scheduled.outcome !== "scheduled") return;
      const taskId = scheduled.tasks[0]!.id;

      const owner = processResearchDispatches({
        orchestrationStore: ownerStore,
        executor: {
          async execute({ signal }) {
            ownerExecutions += 1;
            assert.equal(signal.aborted, false);
            started.resolve(undefined);
            return await finish.promise;
          },
        },
        workerId: "pg-renew-owner",
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

      let renewedTask = await ownerStore.getResearchTask(taskId);
      for (let i = 0; i < 20 && renewedTask?.leaseExpiresAt !== at(160).toISOString(); i += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        renewedTask = await ownerStore.getResearchTask(taskId);
      }
      assert.equal(renewedTask?.leaseExpiresAt, at(160).toISOString());

      const runningRows = await pool.query<{
        task_status: string;
        task_lease: Date;
        attempt_count: string;
        attempt_status: string;
        attempt_lease: Date;
      }>(
        `SELECT
           task.status AS task_status,
           task.lease_expires_at AS task_lease,
           count(attempt.*)::text AS attempt_count,
           min(attempt.status) AS attempt_status,
           min(attempt.lease_expires_at) AS attempt_lease
         FROM run_tasks task
         JOIN run_task_attempts attempt ON attempt.task_id=task.id
         WHERE task.id=$1
         GROUP BY task.id,task.status,task.lease_expires_at`,
        [taskId],
      );
      assert.equal(runningRows.rows[0]?.task_status, "RUNNING");
      assert.equal(runningRows.rows[0]?.attempt_count, "1");
      assert.equal(runningRows.rows[0]?.attempt_status, "RUNNING");
      assert.equal(runningRows.rows[0]?.task_lease.toISOString(), at(160).toISOString());
      assert.equal(runningRows.rows[0]?.attempt_lease.toISOString(), at(160).toISOString());

      elapsed = 101;
      const competitor = await processResearchDispatches({
        orchestrationStore: competitorStore,
        executor: {
          async execute() {
            competitorExecutions += 1;
            return { mustNotRun: true };
          },
        },
        workerId: "pg-renew-competitor",
        now: at(101),
        leaseMs: 100,
        retryDelayMs: 10,
        limit: 1,
        clock: () => at(elapsed),
      });
      assert.equal(competitor[0]?.outcome, "released");
      assert.equal(competitorExecutions, 0);

      const stillOneAttempt = await pool.query<{ count: string; status: string }>(
        `SELECT count(*)::text AS count,min(status) AS status
         FROM run_task_attempts WHERE task_id=$1`,
        [taskId],
      );
      assert.deepEqual(stillOneAttempt.rows[0], { count: "1", status: "RUNNING" });

      elapsed = 120;
      const result = { artifacts: [], edges: [], evidence: [] };
      finish.resolve(result);
      await owner;

      const completed = await ownerStore.getResearchTask(taskId);
      assert.equal(ownerExecutions, 1);
      assert.equal(completed?.status, "SUCCEEDED");
      assert.equal(completed?.attemptCount, 1);
      assert.deepEqual(completed?.acceptedResult, result);

      const finalRows = await pool.query<{ count: string; status: string }>(
        `SELECT count(*)::text AS count,min(status) AS status
         FROM run_task_attempts WHERE task_id=$1`,
        [taskId],
      );
      assert.deepEqual(finalRows.rows[0], { count: "1", status: "SUCCEEDED" });
    } finally {
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await competitorStore.close();
      await ownerStore.close();
      await runStore.close();
    }
  },
);
