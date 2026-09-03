import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { MemoryApiRunControlStore } from "../src/api-control-store.js";
import { buildCanonicalApp as buildApp } from "../src/http-app.js";
import { registerBoundedClearDecisionIntentIntake } from "./fixtures/legacy-bounded-clear-decision-intake.js";
import {
  MemoryIntentAuthorityStore,
  MemoryIntentBoundRunStore,
  MemoryIntentUserMessageStore,
  PostgresIntentAuthorityStore,
  PostgresIntentUserMessageStore,
} from "../src/intent/index.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { MemoryRunStore } from "../src/run-store.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
const clearContent = "I need a tablet under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.";

function clearPayload(turnId = "turn-clear-1", messageId = "message-clear-1") {
  return { turnId, messageId, content: clearContent };
}

test("clear natural-language intent proceeds directly to an exact-bound memory Run", async () => {
  const conversationId = "conversation-m5k-memory";
  const scopeId = "scope-m5k-memory";
  const intentStore = new MemoryIntentAuthorityStore();
  const userMessages = new MemoryIntentUserMessageStore();
  const runStore = new MemoryRunStore();
  const boundRuns = new MemoryIntentBoundRunStore(runStore, intentStore);
  const control = new MemoryApiRunControlStore(runStore, boundRuns);
  const app = buildApp({ runStore, apiControlStore: control });
  registerBoundedClearDecisionIntentIntake(app, {
    intentStore,
    userMessageStore: userMessages,
    apiControlStore: control,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clear-user-messages`,
      payload: clearPayload(),
    });
    assert.equal(response.statusCode, 202);
    const accepted = response.json() as {
      status: string;
      clarificationRequired: boolean;
      runId: string;
      intentVersionId: string;
    };
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.equal(accepted.clarificationRequired, false);

    const source = await userMessages.get("message-clear-1");
    assert.equal(source?.origin, "USER");
    assert.equal(source?.content, clearContent);
    assert.equal(source?.messageHorizon, 1);

    const version = await intentStore.getVersion(accepted.intentVersionId);
    assert.equal(version?.version, 1);
    assert.equal(version?.lineageKind, "INITIAL");
    assert.deepEqual(version?.state.objective?.value, { state: "VALUE", value: "choose a tablet" });
    assert.deepEqual(version?.state.requirements["price.max.usd"]?.value, { state: "VALUE", value: 1300 });
    assert.deepEqual(version?.state.requirements["batteryHours.min"]?.value, { state: "VALUE", value: 12 });
    assert.equal(version?.state.requirements["batteryHours.min"]?.provenance.kind, "EXPLICIT_USER");

    const binding = await boundRuns.getBinding(accepted.runId);
    assert.equal(binding?.intentScopeId, scopeId);
    assert.equal(binding?.intentVersionId, accepted.intentVersionId);
    const run = await runStore.get(accepted.runId);
    assert.equal(run?.status, "CREATED");
    assert.equal(run?.request.goal, "Choose a tablet under $1300 with at least 12 hours of battery life, prioritizing performance.");
    assert.deepEqual(run?.request.hardConstraints, [
      { criterion: "price", operator: "lte", value: 1300 },
      { criterion: "batteryHours", operator: "gte", value: 12 },
    ]);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clear-user-messages`,
      payload: clearPayload(),
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, accepted.runId);
    assert.equal(replay.json().intentVersionId, accepted.intentVersionId);

    const unsupported = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/scope-m5k-unsupported/clear-user-messages`,
      payload: { turnId: "turn-unsupported", messageId: "message-unsupported", content: "Find me a good tablet." },
    });
    assert.equal(unsupported.statusCode, 422);
    assert.equal(await userMessages.get("message-unsupported"), undefined);
  } finally {
    await app.close();
    await intentStore.close();
    await userMessages.close();
  }
});

test("PostgreSQL clear intent persists USER provenance and exact Run binding without clarification", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const conversationId = `conversation-m5k-${randomUUID()}`;
  const scopeId = `scope-m5k-${randomUUID()}`;
  const turnId = randomUUID();
  const messageId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const userMessages = await PostgresIntentUserMessageStore.connect(databaseUrl, { migrate: false });
  const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const control = await PostgresApiRunControlStore.connect(databaseUrl, { migrate: false });
  const app = buildApp({ runStore, apiControlStore: control });
  registerBoundedClearDecisionIntentIntake(app, {
    intentStore,
    userMessageStore: userMessages,
    apiControlStore: control,
  });
  let runId: string | undefined;

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clear-user-messages`,
      payload: clearPayload(turnId, messageId),
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().clarificationRequired, false);
    runId = response.json().runId as string;
    const intentVersionId = response.json().intentVersionId as string;

    const persisted = await pool.query<{
      origin: string;
      message_horizon: string;
      binding_version: string;
      run_status: string;
      dispatches: string;
    }>(
      `SELECT m.origin,m.message_horizon::text,
         b.intent_version_id AS binding_version,
         r.status AS run_status,
         (SELECT count(*)::text FROM dispatch_outbox d WHERE d.run_id=r.id) AS dispatches
       FROM intent_user_messages m
       JOIN run_intent_bindings b ON b.intent_scope_id=m.intent_scope_id
       JOIN runs r ON r.id=b.run_id
       WHERE m.message_id=$1 AND r.id=$2`,
      [messageId, runId],
    );
    assert.equal(persisted.rows[0]?.origin, "USER");
    assert.equal(persisted.rows[0]?.message_horizon, "1");
    assert.equal(persisted.rows[0]?.binding_version, intentVersionId);
    assert.equal(persisted.rows[0]?.run_status, "CREATED");
    assert.equal(persisted.rows[0]?.dispatches, "1");

    const exactVersion = await intentStore.getVersion(intentVersionId);
    assert.equal(exactVersion?.version, 1);
    assert.deepEqual(exactVersion?.state.requirements["batteryHours.min"]?.value, { state: "VALUE", value: 12 });

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clear-user-messages`,
      payload: clearPayload(turnId, messageId),
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, runId);
  } finally {
    await app.close();
    await intentStore.close();
    await userMessages.close();
    if (runId) await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.query("DELETE FROM intent_user_messages WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
