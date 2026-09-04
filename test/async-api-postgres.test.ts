import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { createApiRequestHash } from "../src/api-control-store.js";
import type { KnowledgeAcquisitionProvider } from "../src/knowledge/acquisition.js";
import { buildLegacyTestApp as buildApp } from "../src/legacy/legacy-test-app.js";
import type { RunRequest } from "../src/domain.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
import { PostgresOrchestrationStore } from "../src/postgres-orchestration-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import {
  createStandaloneResearchWorker,
  type StandaloneResearchWorker,
} from "../src/research-worker-process.js";
import { createPendingRun } from "../src/run-execution.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  createStandaloneRunWorker,
  type StandaloneRunWorker,
} from "../src/run-worker-process.js";
import { processRunDispatches } from "../src/run-worker.js";
import { createDefaultOfflineTruthPipeline } from "../src/truth/execution-pipeline.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const databaseUrl = process.env.DATABASE_URL;
const durableTestSubjectResolver = () => ({ subjectId: "durable-async-regression-subject" });
const request: RunRequest = {
  goal: "Choose a laptop under $1300 with at least 12 hours of battery life, prioritizing performance.",
  hardConstraints: [
    { criterion: "price", operator: "lte", value: 1300 },
    { criterion: "batteryHours", operator: "gte", value: 12 },
  ],
  priorities: [{ criterion: "performance", weight: 1 }],
};

function durableRuntimeConfig(connectionString: string, autoMigrate: boolean) {
  return resolveRuntimeConfig({
    DATABASE_URL: connectionString,
    LATTICE_DEPLOYMENT_MODE: "durable",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: autoMigrate ? "true" : "false",
  } as NodeJS.ProcessEnv);
}

async function waitForCompletedRun(
  app: FastifyInstance,
  runId: string,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200);
    const run = response.json<Record<string, unknown>>();
    if (run.status === "COMPLETED") return run;
    if (run.status === "FAILED" || run.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached unexpected terminal status ${String(run.status)}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms.`);
}

const durableKnowledgeProvider: KnowledgeAcquisitionProvider = {
  kind: "deterministic-postgres-knowledge-source",
  async acquire(request) {
    const text = `A source-bound report for: ${request.objective}`;
    return {
      sources: [{
        sourceId: "durable-source",
        canonicalUri: "https://knowledge.example/durable-report",
        title: "Durable source report",
        publisher: "Knowledge Example",
        retrievedAt: "2026-09-04T04:00:00.000Z",
        publishedAt: "2026-09-01T00:00:00.000Z",
        contentType: "text/plain",
        content: text,
      }],
      claims: [{
        claimId: "durable-claim",
        text,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "durable-source", relation: "SUPPORTS", excerpt: text }],
      }],
    };
  },
};

test(
  "PostgreSQL API acceptance rolls back Run and idempotency when initial dispatch cannot commit",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const runStore = await PostgresRunStore.connect(databaseUrl);
    const control = await PostgresApiRunControlStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    const ownerRun = createPendingRun("collision-owner", request, randomUUID());
    const rejectedRun = createPendingRun("collision-rejected", request, randomUUID());
    const logicalKey = `m6-collision:${randomUUID()}`;
    try {
      await runStore.create(ownerRun);
      const ownerDispatch = await runStore.transition({
        runId: ownerRun.id,
        expectedStatus: "CREATED",
        expectedVersion: 1,
        nextStatus: "UNDERSTANDING",
        dispatch: {
          logicalKey,
          queueName: "lattice.run",
          payload: { runId: ownerRun.id },
        },
      });
      assert.deepEqual(ownerDispatch, { outcome: "advanced", version: 2 });

      await assert.rejects(
        control.submitRun({
          run: rejectedRun,
          dispatch: {
            logicalKey,
            queueName: "lattice.run",
            payload: { runId: rejectedRun.id },
          },
          idempotency: {
            scopeKey: "fixture-user",
            httpMethod: "POST",
            canonicalRoute: "/api/v1/conversations/collision-rejected/messages",
            idempotencyKey: "collision-key",
            requestHash: createApiRequestHash(request),
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
        /duplicate key|unique/i,
      );

      const rejected = await pool.query("SELECT id FROM runs WHERE id=$1", [rejectedRun.id]);
      assert.equal(rejected.rowCount, 0);
      const idempotency = await pool.query("SELECT run_id FROM api_idempotency_keys WHERE run_id=$1", [rejectedRun.id]);
      assert.equal(idempotency.rowCount, 0);
      const events = await pool.query("SELECT sequence FROM run_events WHERE run_id=$1", [rejectedRun.id]);
      assert.equal(events.rowCount, 0);
    } finally {
      await pool.query("DELETE FROM runs WHERE id IN ($1,$2)", [ownerRun.id, rejectedRun.id]);
      await pool.end();
      await control.close();
      await runStore.close();
    }
  },
);

test(
  "PostgreSQL durable default composes API with separated Run and Research workers after restart",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    let firstApp: FastifyInstance | undefined;
    let secondApp: FastifyInstance | undefined;
    let runWorker: StandaloneRunWorker | undefined;
    let researchWorker: StandaloneResearchWorker | undefined;
    let runId: string | undefined;
    let conversationId: string | undefined;
    try {
      firstApp = await createRuntimeApp(durableRuntimeConfig(databaseUrl, true), {
        authenticatedSubjectResolver: durableTestSubjectResolver,
      });

      const migrations = await pool.query<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE name IN ('017_durable_research_tasks.sql','018_dispatch_outbox_leases.sql','019_api_idempotency.sql') ORDER BY name",
      );
      assert.deepEqual(
        migrations.rows.map((row) => row.name),
        ["017_durable_research_tasks.sql", "018_dispatch_outbox_leases.sql", "019_api_idempotency.sql"],
      );

      const health = await firstApp.inject({ method: "GET", url: "/health" });
      assert.equal(health.statusCode, 200);
      assert.equal(health.json().mode, "postgres");
      assert.equal(health.json().lifecycle, "async-dispatch");

      const createdConversation = await firstApp.inject({ method: "POST", url: "/api/v1/conversations" });
      assert.equal(createdConversation.statusCode, 201);
      conversationId = createdConversation.json<{ conversation: { id: string } }>().conversation.id;

      const submit = await firstApp.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: {
          turnId: `runtime-${randomUUID()}`,
          message: "Explain how volcanic islands form.",
        },
      });
      assert.equal(submit.statusCode, 202);
      assert.equal(submit.json().status, "RUN_ACCEPTED");
      assert.equal(submit.json().decisionNeed, "NONE");
      runId = submit.json().runId as string;

      await new Promise((resolve) => setTimeout(resolve, 100));
      const beforeRestart = await firstApp.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
      assert.equal(beforeRestart.statusCode, 200);
      assert.equal(beforeRestart.json().status, "CREATED");

      await firstApp.close();
      firstApp = undefined;

      const persisted = await pool.query<{ status: string }>("SELECT status FROM runs WHERE id=$1", [runId]);
      assert.equal(persisted.rows[0]?.status, "CREATED");
      const queued = await pool.query<{ dispatched_at: Date | null }>(
        "SELECT dispatched_at FROM dispatch_outbox WHERE run_id=$1 AND queue_name='lattice.run'",
        [runId],
      );
      assert.equal(queued.rowCount, 1);
      assert.equal(queued.rows[0]?.dispatched_at, null);

      secondApp = await createRuntimeApp(durableRuntimeConfig(databaseUrl, false), {
        authenticatedSubjectResolver: durableTestSubjectResolver,
      });
      researchWorker = await createStandaloneResearchWorker({
        databaseUrl,
        workerId: `m3-e-research:${randomUUID()}`,
        pollMs: 5,
        leaseMs: 30_000,
        retryDelayMs: 1_000,
        batchSize: 10,
      });
      runWorker = await createStandaloneRunWorker({
        databaseUrl,
        workerId: `m3-e-run:${randomUUID()}`,
        pollMs: 5,
        leaseMs: 30_000,
        retryDelayMs: 1_000,
        batchSize: 10,
      });
      researchWorker.start();
      runWorker.start();

      const completed = await waitForCompletedRun(secondApp, runId);
      assert.equal(completed.status, "COMPLETED");

      const events = await secondApp.inject({ method: "GET", url: `/api/v1/runs/${runId}/events` });
      assert.equal(events.statusCode, 200);
      assert.deepEqual(
        events.json().events.map((event: { type: string }) => event.type),
        ["CREATED", "UNDERSTANDING", "PLANNING", "INVESTIGATING", "VALIDATING", "COMPLETED"],
      );

      const outcome = await secondApp.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(outcome.statusCode, 200);
      assert.equal(outcome.json().status, "COMPLETED");
      assert.equal(outcome.json().outcome.kind, "KNOWLEDGE");
      assert.equal(outcome.json().outcome.acceptedUnderstanding, "Explain how volcanic islands form.");

      const decisionPlan = await secondApp.inject({
        method: "GET",
        url: `/api/v1/runs/${runId}/decision-plan`,
      });
      assert.equal(decisionPlan.statusCode, 404);

      const dispatched = await pool.query<{ dispatched_at: Date | null }>(
        "SELECT dispatched_at FROM dispatch_outbox WHERE run_id=$1 AND queue_name='lattice.run'",
        [runId],
      );
      assert.ok(dispatched.rows[0]?.dispatched_at);
    } finally {
      if (runWorker) await runWorker.close();
      if (researchWorker) await researchWorker.close();
      if (firstApp) await firstApp.close();
      if (secondApp) await secondApp.close();
      if (runId) await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      if (conversationId) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
      await pool.end();
    }
  },
);

test(
  "PostgreSQL preserves V36-qualified Knowledge evidence and provenance without decision state",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    let app: FastifyInstance | undefined;
    let runWorker: StandaloneRunWorker | undefined;
    let runId: string | undefined;
    let conversationId: string | undefined;
    try {
      const liveConfig = resolveRuntimeConfig({
        DATABASE_URL: databaseUrl,
        LATTICE_DEPLOYMENT_MODE: "durable",
        LATTICE_TRUTH_MODE: "v36-live",
        LATTICE_AUTO_MIGRATE: "true",
      } as NodeJS.ProcessEnv);
      app = await createRuntimeApp(liveConfig, {
        authenticatedSubjectResolver: durableTestSubjectResolver,
        knowledgeAcquisitionProvider: durableKnowledgeProvider,
      });
      const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
      assert.equal(created.statusCode, 201, created.body);
      conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

      const question = "Explain a fact using an inspectable external source.";
      const submitted = await app.inject({
        method: "POST",
        url: `/api/v1/conversations/${conversationId}/turns`,
        payload: { turnId: `knowledge-pg-${randomUUID()}`, message: question },
      });
      assert.equal(submitted.statusCode, 202, submitted.body);
      runId = submitted.json<{ runId: string }>().runId;

      runWorker = await createStandaloneRunWorker({
        databaseUrl,
        workerId: `knowledge-pg-run:${randomUUID()}`,
        pollMs: 5,
        leaseMs: 30_000,
        retryDelayMs: 1_000,
        batchSize: 10,
        truthMode: "v36-live",
      }, {
        truthPipeline: new KnowledgeAcquisitionTruthPipeline(durableKnowledgeProvider),
      });
      runWorker.start();
      await waitForCompletedRun(app, runId);

      const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
      assert.equal(response.statusCode, 200, response.body);
      const outcome = response.json().outcome;
      assert.equal(outcome.kind, "KNOWLEDGE");
      assert.equal(outcome.acceptedUnderstanding, question);
      assert.equal(outcome.findings[0]?.status, "UNRESOLVED");
      assert.equal(outcome.findings[0]?.confidence, "LOW");
      assert.ok(
        outcome.uncertainties.some((item: string) => item.includes("unresolved V36 proof obligations")),
      );
      assert.equal(outcome.findings[0]?.basis, "SOURCE_REPORT");
      assert.equal(outcome.provenance[0]?.canonicalUri, "https://knowledge.example/durable-report");
      assert.equal(outcome.provenance[0]?.title, "Durable source report");
      assert.equal(outcome.evidence[0]?.admitted, true);
      assert.equal(outcome.evidence[0]?.sourceId, outcome.provenance[0]?.sourceId);

      const plan = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/decision-plan` });
      assert.equal(plan.statusCode, 404, plan.body);
      const persistedTruth = await pool.query<{ canonical_uri: string; metadata_json: unknown }>(
        "SELECT canonical_uri,metadata_json FROM truth_source_artifacts WHERE run_id=$1",
        [runId],
      );
      assert.equal(persistedTruth.rowCount, 1);
      assert.equal(persistedTruth.rows[0]?.canonical_uri, "https://knowledge.example/durable-report");
      assert.match(JSON.stringify(persistedTruth.rows[0]?.metadata_json), /Durable source report/u);
    } finally {
      if (runWorker) await runWorker.close();
      if (app) await app.close();
      if (runId) await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      if (conversationId) await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
      await pool.end();
    }
  },
);

test(
  "PostgreSQL cancellation survives restart and makes queued worker execution inert",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    const firstRunStore = await PostgresRunStore.connect(databaseUrl);
    const firstControl = await PostgresApiRunControlStore.connect(databaseUrl);
    const app = buildApp({ runStore: firstRunStore, apiControlStore: firstControl });
    const submit = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/cancel-pg/messages",
      headers: { "idempotency-key": `cancel-${randomUUID()}` },
      payload: request,
    });
    assert.equal(submit.statusCode, 202);
    const runId = submit.json().runId as string;
    const cancel = await app.inject({ method: "POST", url: `/api/v1/runs/${runId}/cancel` });
    assert.equal(cancel.statusCode, 202);
    assert.equal(cancel.json().status, "CANCELLED");
    await app.close();

    const secondRunStore = await PostgresRunStore.connect(databaseUrl);
    const orchestration = await PostgresOrchestrationStore.connect(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const outcomes = await processRunDispatches({
        runStore: secondRunStore,
        orchestrationStore: orchestration,
        truthPipeline: createDefaultOfflineTruthPipeline(),
        workerId: "cancel-worker",
        now: new Date(Date.now() + 1_000),
      });
      const outcome = outcomes.find((item) => item.runId === runId);
      assert.ok(outcome);
      assert.equal(outcome.outcome, "terminal");

      const run = await secondRunStore.get(runId);
      assert.equal(run?.status, "CANCELLED");
      assert.equal(run?.version, 2);
      assert.deepEqual(run?.events.map((event) => event.type), ["CREATED", "CANCELLED"]);
      assert.equal(await secondRunStore.getTruthSnapshot(runId), undefined);

      const dispatch = await pool.query<{ dispatched_at: Date | null }>(
        "SELECT dispatched_at FROM dispatch_outbox WHERE run_id=$1 AND queue_name='lattice.run'",
        [runId],
      );
      assert.equal(dispatch.rowCount, 1);
      assert.ok(dispatch.rows[0]?.dispatched_at);
    } finally {
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.end();
      await orchestration.close();
      await secondRunStore.close();
    }
  },
);
