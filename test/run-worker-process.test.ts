import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { Pool } from "pg";
import type { RunRequest } from "../src/domain.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
import { createPendingRun } from "../src/run-execution.js";
import {
  PollingRunWorkerLoop,
  resolveRunWorkerProcessConfig,
} from "../src/run-worker-process.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
const windowsProcessSignalsAreForced = process.platform === "win32";
const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

function startWorker(entry: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function stopWorker(worker: ReturnType<typeof startWorker>): Promise<void> {
  if (worker.child.exitCode !== null || worker.child.signalCode !== null) return;
  assert.equal(worker.child.kill("SIGTERM"), true);
  const [code, signal] = await once(worker.child, "exit");
  if (windowsProcessSignalsAreForced) {
    assert.equal(code, null);
    assert.equal(signal, "SIGTERM");
    return;
  }
  assert.equal(code, 0);
  assert.equal(signal, null);
}

test("standalone Run-worker configuration fails closed without PostgreSQL", () => {
  assert.throws(
    () => resolveRunWorkerProcessConfig({} as NodeJS.ProcessEnv),
    /requires DATABASE_URL/,
  );
});

test("standalone Run-worker configuration resolves bounded polling defaults and overrides", () => {
  const defaults = resolveRunWorkerProcessConfig({ DATABASE_URL: "postgresql://fixture" } as NodeJS.ProcessEnv);
  assert.equal(defaults.databaseUrl, "postgresql://fixture");
  assert.match(defaults.workerId, /^lattice-run-worker:/);
  assert.equal(defaults.pollMs, 50);
  assert.equal(defaults.leaseMs, 30_000);
  assert.equal(defaults.retryDelayMs, 1_000);
  assert.equal(defaults.batchSize, 10);

  const configured = resolveRunWorkerProcessConfig({
    DATABASE_URL: " postgresql://fixture ",
    LATTICE_RUN_WORKER_ID: "worker-a",
    LATTICE_RUN_WORKER_POLL_MS: "25",
    LATTICE_RUN_WORKER_LEASE_MS: "45000",
    LATTICE_RUN_WORKER_RETRY_DELAY_MS: "250",
    LATTICE_RUN_WORKER_BATCH_SIZE: "4",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(configured, {
    databaseUrl: "postgresql://fixture",
    workerId: "worker-a",
    pollMs: 25,
    leaseMs: 45_000,
    retryDelayMs: 250,
    batchSize: 4,
  });

  assert.throws(
    () => resolveRunWorkerProcessConfig({
      DATABASE_URL: "postgresql://fixture",
      LATTICE_RUN_WORKER_POLL_MS: "0",
    } as NodeJS.ProcessEnv),
    /LATTICE_RUN_WORKER_POLL_MS/,
  );
});

test("Run-worker polling loop waits for an active poll and schedules no new work after close", async () => {
  let polls = 0;
  let releasePoll: (() => void) | undefined;
  const blockedPoll = new Promise<void>((resolve) => {
    releasePoll = resolve;
  });
  const loop = new PollingRunWorkerLoop({
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

test("Run-worker polling loop reports a poll error and continues polling", async () => {
  let polls = 0;
  const errors: unknown[] = [];
  const loop = new PollingRunWorkerLoop({
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
  "standalone Run and Research workers resume durable V36 research across a Run-worker restart",
  { skip: !databaseUrl, timeout: 20_000 },
  async () => {
    assert.ok(databaseUrl);
    await migrateRuntimeDatabase(databaseUrl);

    const runId = randomUUID();
    const run = createPendingRun(`standalone-worker-${runId}`, request, runId);
    const control = await PostgresApiRunControlStore.connect(databaseUrl, { migrate: false });
    try {
      const submission = await control.submitRun({
        run,
        dispatch: {
          logicalKey: `standalone-run-worker:${runId}`,
          queueName: "lattice.run",
          payload: { runId },
        },
      });
      assert.equal(submission.outcome, "created");
    } finally {
      await control.close();
    }

    const pool = new Pool({ connectionString: databaseUrl });
    const runEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      LATTICE_RUN_WORKER_POLL_MS: "5",
      LATTICE_RUN_WORKER_LEASE_MS: "5000",
      LATTICE_RUN_WORKER_RETRY_DELAY_MS: "5",
      LATTICE_RUN_WORKER_BATCH_SIZE: "4",
    };
    const researchEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      LATTICE_RESEARCH_WORKER_ID: `integration-research-worker-${runId}`,
      LATTICE_RESEARCH_WORKER_POLL_MS: "5",
      LATTICE_RESEARCH_WORKER_LEASE_MS: "5000",
      LATTICE_RESEARCH_WORKER_RETRY_DELAY_MS: "5",
      LATTICE_RESEARCH_WORKER_BATCH_SIZE: "8",
    };
    const runWorkerEntry = "dist/test/helpers/durable-run-worker-main.js";

    let firstRunWorker = startWorker(runWorkerEntry, {
      ...runEnv,
      LATTICE_RUN_WORKER_ID: `integration-run-worker-before-restart-${runId}`,
    });
    let secondRunWorker: ReturnType<typeof startWorker> | undefined;
    let researchWorker: ReturnType<typeof startWorker> | undefined;

    try {
      await waitFor(async () => {
        if (firstRunWorker.child.exitCode !== null) {
          throw new Error(`Initial Run worker exited early: ${firstRunWorker.stderr()}`);
        }
        const state = await pool.query<{ status: string; version: string | number }>(
          "SELECT status,version FROM runs WHERE id=$1",
          [runId],
        );
        const continuation = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM v36_research_continuations WHERE run_id=$1",
          [runId],
        );
        return state.rows[0]?.status === "VALIDATING"
          && Number(state.rows[0]?.version) === 5
          && Number(continuation.rows[0]?.count ?? 0) >= 1;
      }, 8_000);

      await stopWorker(firstRunWorker);
      if (!windowsProcessSignalsAreForced) {
        assert.match(firstRunWorker.stdout(), /LATTICE_RUN_WORKER_STOPPED signal=SIGTERM/);
      }
      assert.equal(firstRunWorker.stderr(), "");

      researchWorker = startWorker("dist/src/research-worker-main.js", researchEnv);
      secondRunWorker = startWorker(runWorkerEntry, {
        ...runEnv,
        LATTICE_RUN_WORKER_ID: `integration-run-worker-after-restart-${runId}`,
      });

      await waitFor(async () => {
        if (secondRunWorker?.child.exitCode !== null) {
          throw new Error(`Restarted Run worker exited early: ${secondRunWorker?.stderr()}`);
        }
        if (researchWorker?.child.exitCode !== null) {
          throw new Error(`Research worker exited early: ${researchWorker?.stderr()}`);
        }
        const result = await pool.query<{ status: string }>("SELECT status FROM runs WHERE id=$1", [runId]);
        const status = result.rows[0]?.status;
        if (status === "FAILED" || status === "CANCELLED") {
          throw new Error(
            `Separated workers produced unexpected terminal status ${status}. `
            + `run-worker stderr=${JSON.stringify(secondRunWorker?.stderr() ?? "")} `
            + `research-worker stderr=${JSON.stringify(researchWorker?.stderr() ?? "")}`,
          );
        }
        if (status !== "COMPLETED") return false;

        const dispatch = await pool.query<{ dispatched_at: Date | null }>(
          "SELECT dispatched_at FROM dispatch_outbox WHERE run_id=$1 AND queue_name='lattice.run'",
          [runId],
        );
        assert.equal(dispatch.rowCount, 1);
        return dispatch.rows[0]?.dispatched_at !== null;
      }, 12_000);

      const continuations = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM v36_research_continuations WHERE run_id=$1",
        [runId],
      );
      assert.ok(Number(continuations.rows[0]?.count ?? 0) >= 2);

      await stopWorker(secondRunWorker);
      await stopWorker(researchWorker);
      if (!windowsProcessSignalsAreForced) {
        assert.match(secondRunWorker.stdout(), /LATTICE_RUN_WORKER_STOPPED signal=SIGTERM/);
        assert.match(researchWorker.stdout(), /LATTICE_RESEARCH_WORKER_STOPPED signal=SIGTERM/);
      }
      assert.equal(secondRunWorker.stderr(), "");
      assert.equal(researchWorker.stderr(), "");
    } finally {
      if (firstRunWorker.child.exitCode === null && firstRunWorker.child.signalCode === null) {
        await stopWorker(firstRunWorker);
      }
      if (secondRunWorker && secondRunWorker.child.exitCode === null && secondRunWorker.child.signalCode === null) {
        await stopWorker(secondRunWorker);
      }
      if (researchWorker && researchWorker.child.exitCode === null && researchWorker.child.signalCode === null) {
        await stopWorker(researchWorker);
      }
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
    }
  },
);
