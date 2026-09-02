import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  PostgresIntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;

function transition(
  scopeId: string,
  id: string,
  turn: string,
  baseIntentVersionId: string | null,
  operations: IntentTransitionCommand["operations"],
): IntentTransitionCommand {
  return {
    transitionId: id,
    intentScopeId: scopeId,
    baseIntentVersionId,
    logicalUserTurnId: turn,
    observedMessageHorizon: 1,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

test("PostgreSQL Intent Authority preserves lineage, idempotency, and CAS across restart", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const scopeId = `intent-${randomUUID()}`;
  const pool = new Pool({ connectionString: databaseUrl });
  let store = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  try {
    const initial = transition(scopeId, randomUUID(), "turn-1", null, [
      { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1300 } },
    ]);
    const scope = await store.createScope({ intentScopeId: scopeId, initialTransition: initial });
    const v1 = await store.getVersion(scope.currentIntentVersionId);
    assert.equal(v1?.version, 1);
    await store.close();

    store = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
    const restored = await store.getScope(scopeId);
    assert.equal(restored?.currentIntentVersionId, scope.currentIntentVersionId);
    assert.deepEqual(await store.getVersion(scope.currentIntentVersionId), v1);

    const base = restored?.currentIntentVersionId;
    assert.ok(base);
    const commandA = transition(scopeId, randomUUID(), "turn-2", base, [
      { op: "SET", path: { kind: "PREFERENCE", key: "performance" }, value: { state: "OPEN" } },
    ]);
    const commandB = transition(scopeId, randomUUID(), "turn-3", base, [
      { op: "SET", path: { kind: "REQUIREMENT", key: "battery" }, value: { state: "VALUE", value: 12 } },
    ]);
    const [a, b] = await Promise.all([
      store.applyTransition(commandA),
      store.applyTransition(commandB),
    ]);
    assert.deepEqual([a.disposition, b.disposition].sort(), ["COMMITTED", "REJECTED_STALE"]);

    const current = await store.getScope(scopeId);
    assert.equal(current?.nextVersionNumber, 3);
    assert.ok(current?.currentIntentVersionId);
    const currentVersion = await store.getVersion(current.currentIntentVersionId);
    assert.equal(currentVersion?.version, 2);

    const reaffirm = transition(scopeId, randomUUID(), "turn-4", current.currentIntentVersionId, [
      { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
    ]);
    const noOp = await store.applyTransition(reaffirm);
    assert.equal(noOp.disposition, "SEMANTIC_NOOP");
    const replay = await store.applyTransition(reaffirm);
    assert.equal(replay.disposition, "REPLAYED");
    assert.equal(replay.replayedDisposition, "SEMANTIC_NOOP");

    const counts = await pool.query<{ versions: string; turns: string; migration: string }>(
      `SELECT
         (SELECT count(*)::text FROM intent_versions WHERE intent_scope_id=$1) AS versions,
         (SELECT count(*)::text FROM intent_transitions WHERE intent_scope_id=$1) AS turns,
         (SELECT count(*)::text FROM schema_migrations WHERE name='022_intent_authority_core.sql') AS migration`,
      [scopeId],
    );
    assert.equal(counts.rows[0]?.versions, "2");
    assert.equal(counts.rows[0]?.turns, "4");
    assert.equal(counts.rows[0]?.migration, "1");
  } finally {
    await store.close();
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
