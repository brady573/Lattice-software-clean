import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  PostgresIntentAuthorityStore,
  PostgresIntentBoundRunStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { createPendingRun } from "../src/run-execution.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;

const request = {
  goal: "choose a laptop",
  priorities: [{ criterion: "performance", weight: 1 }],
  hardConstraints: [{ criterion: "budget", operator: "lte" as const, value: 1300 }],
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

test("PostgreSQL atomically persists an exact Run IntentVersion binding across restart", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const scopeId = `intent-${randomUUID()}`;
  const runId = randomUUID();
  const rejectedRunId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  let boundRuns = await PostgresIntentBoundRunStore.connect(databaseUrl, { migrate: false });
  let runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  try {
    const scope = await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, randomUUID(), 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });
    const v1 = scope.currentIntentVersionId;

    const binding = await boundRuns.create(
      createPendingRun("conversation-1", request, runId),
      { intentScopeId: scopeId, intentVersionId: v1 },
    );
    assert.equal(binding.runId, runId);
    assert.equal(binding.intentScopeId, scopeId);
    assert.equal(binding.intentVersionId, v1);
    assert.equal((await runStore.get(runId))?.id, runId);

    const advanced = await intentStore.applyTransition(transition(scopeId, randomUUID(), 2, v1, [
      { op: "SET", path: { kind: "PREFERENCE", key: "battery" }, value: { state: "VALUE", value: 12 } },
    ]));
    assert.equal(advanced.disposition, "COMMITTED");
    assert.notEqual((await intentStore.getScope(scopeId))?.currentIntentVersionId, v1);

    await boundRuns.close();
    boundRuns = await PostgresIntentBoundRunStore.connect(databaseUrl, { migrate: false });
    assert.deepEqual(await boundRuns.getBinding(runId), binding);

    await assert.rejects(
      boundRuns.create(
        createPendingRun("conversation-1", request, rejectedRunId),
        { intentScopeId: `${scopeId}-wrong`, intentVersionId: v1 },
      ),
      /existing exact IntentVersion/,
    );
    assert.equal(await runStore.get(rejectedRunId), undefined);

    const counts = await pool.query<{ bindings: string; migration: string }>(
      `SELECT
         (SELECT count(*)::text FROM run_intent_bindings WHERE run_id=$1) AS bindings,
         (SELECT count(*)::text FROM schema_migrations WHERE name='025_run_intent_bindings.sql') AS migration`,
      [runId],
    );
    assert.equal(counts.rows[0]?.bindings, "1");
    assert.equal(counts.rows[0]?.migration, "1");
  } finally {
    await boundRuns.close();
    await runStore.close();
    await intentStore.close();
    await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [[runId, rejectedRunId]]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
