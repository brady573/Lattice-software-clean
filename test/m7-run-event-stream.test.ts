import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { buildCanonicalApp as buildApp } from "../src/http-app.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { registerRunEventStream } from "../src/progress/run-event-stream.js";
import { createPendingRun } from "../src/run-execution.js";
import { MemoryRunStore } from "../src/run-store.js";

const databaseUrl = process.env.DATABASE_URL;

const request = {
  goal: "Choose a bounded option",
  priorities: [{ criterion: "price", weight: 1 }],
  hardConstraints: [{ criterion: "price", operator: "lte" as const, value: 1_000 }],
};

async function listen(app: ReturnType<typeof buildApp>): Promise<string> {
  return app.listen({ host: "127.0.0.1", port: 0 });
}

test("M7 Run progress streams durable events and reconnects strictly after Last-Event-ID", async () => {
  const store = new MemoryRunStore();
  const run = createPendingRun("conversation-m7-progress", request, randomUUID());
  await store.create(run);

  const app = buildApp({ runStore: store });
  registerRunEventStream(app, { runStore: store, pollIntervalMs: 10 });
  const address = await listen(app);

  try {
    const cancellation = setTimeout(() => {
      void store.transition({
        runId: run.id,
        expectedStatus: "CREATED",
        expectedVersion: 1,
        nextStatus: "CANCELLED",
      });
    }, 25);

    const response = await fetch(`${address}/api/v1/runs/${run.id}/events/stream`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    const body = await response.text();
    clearTimeout(cancellation);

    assert.match(body, /retry: 1000/);
    assert.match(body, /id: 1\nevent: run-progress\ndata: .*"sequence":1.*"type":"CREATED"/);
    assert.match(body, /id: 2\nevent: run-progress\ndata: .*"sequence":2.*"type":"CANCELLED"/);

    const reconnect = await fetch(`${address}/api/v1/runs/${run.id}/events/stream`, {
      headers: { "Last-Event-ID": "1" },
    });
    assert.equal(reconnect.status, 200);
    const resumed = await reconnect.text();
    assert.doesNotMatch(resumed, /id: 1\n/);
    assert.match(resumed, /id: 2\nevent: run-progress\ndata: .*"type":"CANCELLED"/);

    const invalid = await fetch(`${address}/api/v1/runs/${run.id}/events/stream`, {
      headers: { "Last-Event-ID": "not-a-sequence" },
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "INVALID_LAST_EVENT_ID" });

    const missing = await fetch(`${address}/api/v1/runs/missing/events/stream`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "RUN_NOT_FOUND" });
  } finally {
    await app.close();
  }
});

test("M7 PostgreSQL Run progress resumes from durable event history after store restart", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresRunStore.migrate(databaseUrl);

  const runId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  let store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const run = createPendingRun(`conversation-${randomUUID()}`, request, runId);

  try {
    await store.create(run);
    const cancelled = await store.transition({
      runId,
      expectedStatus: "CREATED",
      expectedVersion: 1,
      nextStatus: "CANCELLED",
    });
    assert.equal(cancelled.outcome, "advanced");
    await store.close();

    store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
    const app = buildApp({ runStore: store });
    registerRunEventStream(app, { runStore: store, pollIntervalMs: 10 });
    const address = await listen(app);

    try {
      const response = await fetch(`${address}/api/v1/runs/${runId}/events/stream`, {
        headers: { "Last-Event-ID": "1" },
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.doesNotMatch(body, /id: 1\n/);
      assert.match(body, /id: 2\nevent: run-progress\ndata: .*"sequence":2.*"type":"CANCELLED"/);

      const malformed = await fetch(`${address}/api/v1/runs/not-a-uuid/events/stream`);
      assert.equal(malformed.status, 404);
      assert.deepEqual(await malformed.json(), { error: "RUN_NOT_FOUND" });
    } finally {
      await app.close();
    }
  } finally {
    await pool.query("DELETE FROM run_events WHERE run_id=$1", [runId]);
    await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    await pool.end();
  }
});
