import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import type { LatticeRun, RunRequest } from "../src/domain.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
import { PostgresOrchestrationStore } from "../src/postgres-orchestration-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { processRunDispatches } from "../src/run-worker.js";
import { createDefaultOfflineTruthPipeline } from "../src/truth/execution-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;

const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

function createInitialRun(runId: string): LatticeRun {
  return {
    id: runId,
    conversationId: `transition-${runId}`,
    status: "CREATED",
    version: 1,
    request,
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [{ sequence: 1, type: "CREATED" }],
  };
}

test(
  "PostgreSQL preserves async Run handoff, V36 truth, authoritative decision, and result across API/worker restart",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const firstStore = await PostgresRunStore.connect(databaseUrl);
    const firstControl = await PostgresApiRunControlStore.connect(databaseUrl);
    const firstApp = buildApp({ runStore: firstStore, apiControlStore: firstControl });
    const submitRequest = () => firstApp.inject({
      method: "POST",
      url: "/api/v1/conversations/durable-demo/messages",
      headers: { "idempotency-key": "durable-demo-message" },
      payload: request,
    });
    const [submit, repeated] = await Promise.all([submitRequest(), submitRequest()]);
    assert.equal(submit.statusCode, 202);
    assert.equal(repeated.statusCode, 202);
    const accepted = submit.json();
    assert.equal(accepted.status, "CREATED");
    assert.equal(typeof accepted.runId, "string");
    assert.equal(repeated.json().runId, accepted.runId);

    const conflict = await firstApp.inject({
      method: "POST",
      url: "/api/v1/conversations/durable-demo/messages",
      headers: { "idempotency-key": "durable-demo-message" },
      payload: { ...request, goal: `${request.goal} changed` },
    });
    assert.equal(conflict.statusCode, 409);

    const beforeWorker = await firstApp.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}` });
    assert.equal(beforeWorker.statusCode, 200);
    assert.equal(beforeWorker.json().status, "CREATED");
    assert.equal(beforeWorker.json().version, 1);
    const pendingResult = await firstApp.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/result` });
    assert.equal(pendingResult.statusCode, 409);
    assert.equal(pendingResult.json().status, "CREATED");
    await firstApp.close();

    const secondStore = await PostgresRunStore.connect(databaseUrl);
    const orchestration = await PostgresOrchestrationStore.connect(databaseUrl);
    const workerOutcomes = await processRunDispatches({
      runStore: secondStore,
      orchestrationStore: orchestration,
      truthPipeline: createDefaultOfflineTruthPipeline(),
      workerId: "worker-after-restart",
      now: new Date(Date.now() + 1_000),
      leaseMs: 30_000,
      limit: 10,
    });
    assert.equal(workerOutcomes.length, 1);
    assert.equal(workerOutcomes[0]?.runId, accepted.runId);
    assert.equal(workerOutcomes[0]?.outcome, "completed");

    const secondApp = buildApp({ runStore: secondStore });
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const runResponse = await secondApp.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}` });
      assert.equal(runResponse.statusCode, 200);
      const run = runResponse.json();
      assert.equal(run.id, accepted.runId);
      assert.equal(run.conversationId, "durable-demo");
      assert.equal(run.status, "COMPLETED");
      assert.equal(run.version, 8);
      assert.equal(run.truthAssessmentIds.length, 9);
      assert.equal(run.decision.truthAssessmentIds.length, 9);

      const eventsResponse = await secondApp.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/events` });
      assert.equal(eventsResponse.statusCode, 200);
      assert.deepEqual(
        eventsResponse.json().events.map((event: { sequence: number; type: string }) => [event.sequence, event.type]),
        [
          [1, "CREATED"],
          [2, "UNDERSTANDING"],
          [3, "PLANNING"],
          [4, "INVESTIGATING"],
          [5, "VALIDATING"],
          [6, "DECIDING"],
          [7, "EXPLAINING"],
          [8, "COMPLETED"],
        ],
      );

      const resultResponse = await secondApp.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/result` });
      assert.equal(resultResponse.statusCode, 200);
      const result = resultResponse.json();
      assert.equal(result.status, "COMPLETED");
      assert.equal(result.decision.winnerCandidateId, "nova-air");
      assert.equal(result.decision.truthAssessmentIds.length, 9);
      assert.match(result.explanation, /Nova Air/);

      const truthCounts = await pool.query<{
        claims: string;
        evidence: string;
        assessments: string;
        components: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM truth_claims WHERE run_id = $1) AS claims,
           (SELECT count(*)::text FROM truth_claim_evidence WHERE run_id = $1) AS evidence,
           (SELECT count(*)::text FROM truth_assessments WHERE run_id = $1) AS assessments,
           (SELECT count(*)::text FROM truth_provenance_components WHERE run_id = $1) AS components`,
        [accepted.runId],
      );
      assert.deepEqual(truthCounts.rows[0], { claims: "9", evidence: "9", assessments: "9", components: "2" });

      const admitted = await pool.query<{ external_evidence_id: string }>(
        `SELECT external_evidence_id
         FROM truth_claim_evidence
         WHERE run_id = $1 AND admitted
         ORDER BY external_evidence_id`,
        [accepted.runId],
      );
      for (const evidenceId of result.decision.evidenceIds as string[]) {
        assert.ok(admitted.rows.some((row) => row.external_evidence_id === evidenceId));
      }

      const idempotency = await pool.query<{ request_hash: string; response_status: number; run_id: string }>(
        `SELECT request_hash,response_status,run_id
         FROM api_idempotency_keys
         WHERE run_id=$1`,
        [accepted.runId],
      );
      assert.equal(idempotency.rowCount, 1);
      assert.equal(idempotency.rows[0]?.response_status, 202);
      assert.equal(idempotency.rows[0]?.run_id, accepted.runId);
      assert.equal(idempotency.rows[0]?.request_hash.length, 64);

      const dispatch = await pool.query<{ queue_name: string; delivery_attempts: number; dispatched_at: Date | null }>(
        `SELECT queue_name,delivery_attempts,dispatched_at
         FROM dispatch_outbox
         WHERE run_id=$1 AND queue_name='lattice.run'`,
        [accepted.runId],
      );
      assert.equal(dispatch.rowCount, 1);
      assert.equal(dispatch.rows[0]?.delivery_attempts, 1);
      assert.ok(dispatch.rows[0]?.dispatched_at);

      const bundle = await secondStore.getTruthBundle(accepted.runId);
      assert.ok(bundle);
      assert.equal(bundle.runId, accepted.runId);
      assert.equal(bundle.assessments.length, 9);
      assert.ok(bundle.assessments.every((assessment) => assessment.verdict === "TRUE"));
    } finally {
      await pool.query("DELETE FROM runs WHERE id = $1", [accepted.runId]);
      await pool.end();
      await orchestration.close();
      await secondApp.close();
    }
  },
);

test(
  "Run epoch transition atomically appends an event and outbox dispatch while stale epochs have no side effects",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const store = await PostgresRunStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const runId = randomUUID();
    const rollbackRunId = randomUUID();
    const logicalKey = `run:${runId}:understanding:${randomUUID()}`;
    try {
      await store.create(createInitialRun(runId));
      const advanced = await store.transition({
        runId,
        expectedStatus: "CREATED",
        expectedVersion: 1,
        nextStatus: "UNDERSTANDING",
        dispatch: {
          logicalKey,
          queueName: "lattice.orchestrate",
          payload: { runId, version: 2 },
        },
      });
      assert.deepEqual(advanced, { outcome: "advanced", version: 2 });

      const stale = await store.transition({
        runId,
        expectedStatus: "CREATED",
        expectedVersion: 1,
        nextStatus: "UNDERSTANDING",
        dispatch: {
          logicalKey: `${logicalKey}:stale`,
          queueName: "lattice.orchestrate",
          payload: { runId, version: 2 },
        },
      });
      assert.deepEqual(stale, { outcome: "stale" });

      const persisted = await pool.query<{ status: string; version: string | number }>(
        "SELECT status, version FROM runs WHERE id = $1",
        [runId],
      );
      assert.equal(persisted.rows[0]?.status, "UNDERSTANDING");
      assert.equal(Number(persisted.rows[0]?.version), 2);

      const events = await pool.query<{ sequence: string | number; event_type: string }>(
        "SELECT sequence, event_type FROM run_events WHERE run_id = $1 ORDER BY sequence",
        [runId],
      );
      assert.deepEqual(events.rows.map((event) => [Number(event.sequence), event.event_type]), [
        [1, "CREATED"],
        [2, "UNDERSTANDING"],
      ]);

      const dispatches = await pool.query<{ logical_key: string; queue_name: string }>(
        "SELECT logical_key, queue_name FROM dispatch_outbox WHERE run_id = $1",
        [runId],
      );
      assert.equal(dispatches.rowCount, 1);
      assert.equal(dispatches.rows[0]?.logical_key, logicalKey);
      assert.equal(dispatches.rows[0]?.queue_name, "lattice.orchestrate");

      await store.create(createInitialRun(rollbackRunId));
      await assert.rejects(
        store.transition({
          runId: rollbackRunId,
          expectedStatus: "CREATED",
          expectedVersion: 1,
          nextStatus: "UNDERSTANDING",
          dispatch: {
            logicalKey,
            queueName: "lattice.orchestrate",
            payload: { runId: rollbackRunId, version: 2 },
          },
        }),
        /duplicate key|unique/i,
      );

      const rolledBack = await pool.query<{ status: string; version: string | number }>(
        "SELECT status, version FROM runs WHERE id = $1",
        [rollbackRunId],
      );
      assert.equal(rolledBack.rows[0]?.status, "CREATED");
      assert.equal(Number(rolledBack.rows[0]?.version), 1);
      const rollbackEvents = await pool.query<{ event_type: string }>(
        "SELECT event_type FROM run_events WHERE run_id = $1 ORDER BY sequence",
        [rollbackRunId],
      );
      assert.deepEqual(rollbackEvents.rows.map((event) => event.event_type), ["CREATED"]);
    } finally {
      await pool.query("DELETE FROM runs WHERE id IN ($1, $2)", [runId, rollbackRunId]);
      await pool.end();
      await store.close();
    }
  },
);
