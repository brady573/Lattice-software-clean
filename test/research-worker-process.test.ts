import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { Pool } from "pg";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import {
  defineResearchTask,
  MemoryOrchestrationStore,
} from "../src/orchestration-store.js";
import { PostgresOrchestrationStore } from "../src/postgres-orchestration-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import {
  PollingResearchWorkerLoop,
  resolveResearchWorkerProcessConfig,
} from "../src/research-worker-process.js";
import { processResearchDispatches } from "../src/research-worker.js";
import { MemoryRunStore } from "../src/run-store.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
const windowsProcessSignalsAreForced = process.platform === "win32";
const request: RunRequest = {
  goal: "Exercise the durable Research-worker process role.",
  hardConstraints: [],
  priorities: [],
};

function investigatingRun(id: string): LatticeRun {
  return {
    id,
    conversationId: `research-worker-${id}`,
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

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

test("Research worker persists only the injected executor result and acknowledges completed work", async () => {
  const runStore = new MemoryRunStore();
  const orchestrationStore = new MemoryOrchestrationStore(runStore);
  const runId = randomUUID();
  await runStore.create(investigatingRun(runId));
  const definition = defineResearchTask({
    runId,
    planVersion: 1,
    normalizedInputs: { query: "bounded fixture research" },
  });
  const scheduled = await orchestrationStore.scheduleResearchGraph({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    tasks: [definition],
  });
  assert.equal(scheduled.outcome, "scheduled");
  if (scheduled.outcome !== "scheduled") return;

  const now = new Date("2026-08-27T22:00:00.000Z");
  const operationalResult = {
    artifacts: [{ id: "fixture-observation", untrusted: true }],
    sourceAuthority: "UNTRUSTED",
  };
  const outcomes = await processResearchDispatches({
    orchestrationStore,
    executor: {
      async execute({ task }) {
        assert.equal(task.id, scheduled.tasks[0]!.id);
        assert.deepEqual(task.input, { query: "bounded fixture research" });
        return operationalResult;
      },
    },
    workerId: "research-worker-success",
    now,
    leaseMs: 30_000,
    retryDelayMs: 100,
    limit: 1,
    clock: () => new Date(now.getTime() + 10),
  });

  assert.deepEqual(outcomes, [{
    dispatchId: 1,
    runId,
    taskId: scheduled.tasks[0]!.id,
    outcome: "completed",
  }]);
  const persisted = await orchestrationStore.getResearchTask(scheduled.tasks[0]!.id);
  assert.ok(persisted);
  assert.equal(persisted.status, "SUCCEEDED");
  assert.deepEqual(persisted.acceptedResult, operationalResult);

  const wakeups = await orchestrationStore.claimDispatches({
    queueName: "lattice.orchestrate",
    workerId: "orchestrator-probe",
    now: new Date(now.getTime() + 20),
    leaseMs: 1_000,
    limit: 10,
  });
  assert.equal(wakeups.length, 1);
  assert.equal((wakeups[0]?.payload as { taskId: string }).taskId, scheduled.tasks[0]!.id);

  const run = await runStore.get(runId);
  assert.equal(run?.status, "INVESTIGATING");
  assert.equal(run?.version, 4);
});

test("Research worker records executor failure through durable retry semantics", async () => {
  const runStore = new MemoryRunStore();
  const orchestrationStore = new MemoryOrchestrationStore(runStore);
  const runId = randomUUID();
  await runStore.create(investigatingRun(runId));
  const definition = defineResearchTask({
    runId,
    planVersion: 1,
    normalizedInputs: { query: "retry fixture" },
    maxAttempts: 2,
  });
  const scheduled = await orchestrationStore.scheduleResearchGraph({
    runId,
    expectedStatus: "INVESTIGATING",
    expectedVersion: 4,
    tasks: [definition],
  });
  assert.equal(scheduled.outcome, "scheduled");
  if (scheduled.outcome !== "scheduled") return;

  const now = new Date("2026-08-27T22:10:00.000Z");
  const outcomes = await processResearchDispatches({
    orchestrationStore,
    executor: {
      async execute() {
        throw new Error("fixture provider unavailable");
      },
    },
    workerId: "research-worker-retry",
    now,
    leaseMs: 30_000,
    retryDelayMs: 250,
    limit: 1,
    clock: () => new Date(now.getTime() + 10),
  });

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.outcome, "retry_scheduled");
  const persisted = await orchestrationStore.getResearchTask(scheduled.tasks[0]!.id);
  assert.ok(persisted);
  assert.equal(persisted.status, "PENDING");
  assert.equal(persisted.attemptCount, 1);
  assert.equal(persisted.acceptedResult, null);

  assert.equal((await orchestrationStore.claimDispatches({
    queueName: "lattice.research",
    workerId: "too-early",
    now: new Date(now.getTime() + 200),
    leaseMs: 1_000,
    limit: 10,
  })).length, 0);
  const retry = await orchestrationStore.claimDispatches({
    queueName: "lattice.research",
    workerId: "retry-probe",
    now: new Date(now.getTime() + 260),
    leaseMs: 1_000,
    limit: 10,
  });
  assert.equal(retry.length, 1);
  assert.equal((retry[0]?.payload as { taskId: string }).taskId, scheduled.tasks[0]!.id);
});

test("standalone Research-worker configuration fails closed without PostgreSQL", () => {
  assert.throws(
    () => resolveResearchWorkerProcessConfig({} as NodeJS.ProcessEnv),
    /requires DATABASE_URL/,
  );
});

test("standalone Research-worker configuration resolves bounded polling defaults and overrides", () => {
  const defaults = resolveResearchWorkerProcessConfig({ DATABASE_URL: "postgresql://fixture" } as NodeJS.ProcessEnv);
  assert.equal(defaults.databaseUrl, "postgresql://fixture");
  assert.match(defaults.workerId, /^lattice-research-worker:/);
  assert.equal(defaults.pollMs, 50);
  assert.equal(defaults.leaseMs, 30_000);
  assert.equal(defaults.retryDelayMs, 1_000);
  assert.equal(defaults.batchSize, 10);

  const configured = resolveResearchWorkerProcessConfig({
    DATABASE_URL: " postgresql://fixture ",
    LATTICE_RESEARCH_WORKER_ID: "research-a",
    LATTICE_RESEARCH_WORKER_POLL_MS: "25",
    LATTICE_RESEARCH_WORKER_LEASE_MS: "45000",
    LATTICE_RESEARCH_WORKER_RETRY_DELAY_MS: "250",
    LATTICE_RESEARCH_WORKER_BATCH_SIZE: "4",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(configured, {
    databaseUrl: "postgresql://fixture",
    workerId: "research-a",
    pollMs: 25,
    leaseMs: 45_000,
    retryDelayMs: 250,
    batchSize: 4,
  });

  assert.throws(
    () => resolveResearchWorkerProcessConfig({
      DATABASE_URL: "postgresql://fixture",
      LATTICE_RESEARCH_WORKER_LEASE_MS: "999",
    } as NodeJS.ProcessEnv),
    /LATTICE_RESEARCH_WORKER_LEASE_MS/,
  );
});

test("Research-worker polling loop waits for an active poll and schedules no new work after close", async () => {
  let polls = 0;
  let releasePoll: (() => void) | undefined;
  const blockedPoll = new Promise<void>((resolve) => {
    releasePoll = resolve;
  });
  const loop = new PollingResearchWorkerLoop({
    pollMs: 5,
    poll: async () => {
      polls += 1;
      await blockedPoll;
    },
  });

  loop.start();
  await waitFor(() => polls === 1);

  let closeSettled = false;
  const close = loop.close().then(() => {
    closeSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(closeSettled, false);

  assert.ok(releasePoll);
  releasePoll();
  await close;
  assert.equal(closeSettled, true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(polls, 1);
});

test("Research-worker polling loop reports a poll error and continues polling", async () => {
  let polls = 0;
  const errors: unknown[] = [];
  const loop = new PollingResearchWorkerLoop({
    pollMs: 2,
    poll: async () => {
      polls += 1;
      if (polls === 1) throw new Error("fixture poll failure");
    },
    onError(error) {
      errors.push(error);
    },
  });

  loop.start();
  await waitFor(() => polls >= 2);
  await loop.close();
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /fixture poll failure/);
});

test(
  "standalone Research-worker process fails closed through durable task exhaustion and shuts down on SIGTERM",
  { skip: !databaseUrl, timeout: 15_000 },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);

    const runId = randomUUID();
    const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const orchestrationStore = await PostgresOrchestrationStore.connect(databaseUrl, { migrate: false });
    const pool = new Pool({ connectionString: databaseUrl });
    const child = spawn(process.execPath, ["dist/src/research-worker-main.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        LATTICE_RESEARCH_WORKER_ID: `integration-research-${runId}`,
        LATTICE_RESEARCH_WORKER_POLL_MS: "5",
        LATTICE_RESEARCH_WORKER_LEASE_MS: "5000",
        LATTICE_RESEARCH_WORKER_RETRY_DELAY_MS: "10",
        LATTICE_RESEARCH_WORKER_BATCH_SIZE: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });

    try {
      await runStore.create(investigatingRun(runId));
      const definition = defineResearchTask({
        runId,
        planVersion: 1,
        normalizedInputs: { query: "standalone fail-closed driver probe" },
        maxAttempts: 1,
      });
      const scheduled = await orchestrationStore.scheduleResearchGraph({
        runId,
        expectedStatus: "INVESTIGATING",
        expectedVersion: 4,
        tasks: [definition],
      });
      assert.equal(scheduled.outcome, "scheduled");
      if (scheduled.outcome !== "scheduled") return;
      const taskId = scheduled.tasks[0]!.id;

      await waitFor(async () => {
        if (child.exitCode !== null) {
          throw new Error(`Standalone Research worker exited before task exhaustion with code ${child.exitCode}: ${stderr}`);
        }
        const result = await pool.query<{ status: string }>("SELECT status FROM run_tasks WHERE id=$1", [taskId]);
        return result.rows[0]?.status === "FAILED";
      }, 10_000);

      const task = await orchestrationStore.getResearchTask(taskId);
      assert.ok(task);
      assert.equal(task.status, "FAILED");
      assert.equal(task.acceptedResult, null);
      assert.equal(task.attemptCount, 1);

      const run = await runStore.get(runId);
      assert.equal(run?.status, "INVESTIGATING");
      assert.equal(run?.version, 4);

      const researchDispatch = await pool.query<{ dispatched_at: Date | null }>(
        "SELECT dispatched_at FROM dispatch_outbox WHERE run_id=$1 AND queue_name='lattice.research'",
        [runId],
      );
      assert.equal(researchDispatch.rowCount, 1);
      assert.ok(researchDispatch.rows[0]?.dispatched_at);

      const wakeup = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM dispatch_outbox WHERE run_id=$1 AND queue_name='lattice.orchestrate'",
        [runId],
      );
      assert.equal(wakeup.rows[0]?.count, "1");

      assert.equal(child.kill("SIGTERM"), true);
      const [code, signal] = await once(child, "exit");
      if (windowsProcessSignalsAreForced) {
        assert.equal(code, null);
        assert.equal(signal, "SIGTERM");
      } else {
        assert.equal(code, 0);
        assert.equal(signal, null);
      }
      assert.match(stdout, /LATTICE_RESEARCH_WORKER_READY/);
      if (!windowsProcessSignalsAreForced) {
        assert.match(stdout, /LATTICE_RESEARCH_WORKER_STOPPED signal=SIGTERM/);
      }
      assert.equal(stderr, "");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await orchestrationStore.close();
      await runStore.close();
    }
  },
);
