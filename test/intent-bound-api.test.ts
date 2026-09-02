import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { MemoryApiRunControlStore } from "../src/api-control-store.js";
import { buildApp } from "../src/app.js";
import type { RunRequest } from "../src/domain.js";
import {
  MemoryIntentAuthorityStore,
  MemoryIntentBoundRunStore,
  PostgresIntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { MemoryRunStore } from "../src/run-store.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;
const request: RunRequest = {
  goal: "choose a laptop",
  priorities: [{ criterion: "performance", weight: 1 }],
  hardConstraints: [{ criterion: "budget", operator: "lte", value: 1300 }],
};

function transition(
  scopeId: string,
  id: string,
  turn: number,
  baseIntentVersionId: string | null,
  operations: IntentTransitionCommand["operations"],
): IntentTransitionCommand {
  return {
    transitionId: id,
    intentScopeId: scopeId,
    baseIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

test("authoritative memory Run intake binds the exact IntentVersion without promoting legacy intake", async () => {
  const scopeId = "scope-api-memory";
  const intentStore = new MemoryIntentAuthorityStore(() => "intent-api-v1");
  const runStore = new MemoryRunStore();
  const boundRuns = new MemoryIntentBoundRunStore(runStore, intentStore);
  const control = new MemoryApiRunControlStore(runStore, boundRuns);
  const app = buildApp({ runStore, apiControlStore: control });
  try {
    await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, "transition-api-1", 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });

    const route = `/api/v1/conversations/conversation-api/intent-scopes/${scopeId}/versions/intent-api-v1/runs`;
    const created = await app.inject({
      method: "POST",
      url: route,
      headers: { "idempotency-key": "intent-bound-memory" },
      payload: request,
    });
    assert.equal(created.statusCode, 202);
    const runId = created.json().runId as string;
    assert.deepEqual(
      await boundRuns.getBinding(runId),
      {
        runId,
        intentScopeId: scopeId,
        intentVersionId: "intent-api-v1",
        boundAt: (await boundRuns.getBinding(runId))?.boundAt,
      },
    );

    const replay = await app.inject({
      method: "POST",
      url: route,
      headers: { "idempotency-key": "intent-bound-memory" },
      payload: request,
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, runId);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/conversation-api/intent-scopes/${scopeId}/versions/missing-version/runs`,
      payload: request,
    });
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.json().error, "INTENT_BOUND_RUN_REJECTED");

    const legacy = await app.inject({
      method: "POST",
      url: "/api/v1/conversations/conversation-api/messages",
      payload: request,
    });
    assert.equal(legacy.statusCode, 202);
    assert.equal(await boundRuns.getBinding(legacy.json().runId as string), undefined);
  } finally {
    await app.close();
    await intentStore.close();
  }
});

test("PostgreSQL authoritative Run intake atomically persists exact binding, idempotency, and dispatch", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const scopeId = `intent-api-${randomUUID()}`;
  const conversationId = `conversation-api-${randomUUID()}`;
  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const control = await PostgresApiRunControlStore.connect(databaseUrl, { migrate: false });
  const app = buildApp({ runStore, apiControlStore: control });
  let runId: string | undefined;
  try {
    const scope = await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, randomUUID(), 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });
    const intentVersionId = scope.currentIntentVersionId;
    const route = `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/versions/${intentVersionId}/runs`;

    const created = await app.inject({
      method: "POST",
      url: route,
      headers: { "idempotency-key": "intent-bound-postgres" },
      payload: request,
    });
    assert.equal(created.statusCode, 202);
    runId = created.json().runId as string;

    const persisted = await pool.query<{
      intent_scope_id: string;
      intent_version_id: string;
      dispatches: string;
      idempotency: string;
    }>(
      `SELECT b.intent_scope_id,b.intent_version_id,
         (SELECT count(*)::text FROM dispatch_outbox d WHERE d.run_id=b.run_id) AS dispatches,
         (SELECT count(*)::text FROM api_idempotency_keys i WHERE i.run_id=b.run_id) AS idempotency
       FROM run_intent_bindings b
       WHERE b.run_id=$1`,
      [runId],
    );
    assert.equal(persisted.rows[0]?.intent_scope_id, scopeId);
    assert.equal(persisted.rows[0]?.intent_version_id, intentVersionId);
    assert.equal(persisted.rows[0]?.dispatches, "1");
    assert.equal(persisted.rows[0]?.idempotency, "1");

    const replay = await app.inject({
      method: "POST",
      url: route,
      headers: { "idempotency-key": "intent-bound-postgres" },
      payload: request,
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, runId);

    const beforeRejected = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM runs WHERE conversation_id=$1",
      [`${conversationId}-rejected`],
    );
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}-rejected/intent-scopes/${scopeId}/versions/missing-version/runs`,
      payload: request,
    });
    assert.equal(rejected.statusCode, 422);
    const afterRejected = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM runs WHERE conversation_id=$1",
      [`${conversationId}-rejected`],
    );
    assert.equal(afterRejected.rows[0]?.count, beforeRejected.rows[0]?.count);
  } finally {
    await app.close();
    await intentStore.close();
    if (runId) await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
