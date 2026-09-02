import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  PostgresIntentAuthorityStore,
  emptyIntentState,
  readIntentValue,
  type IntentCorrectionCommand,
  type IntentResetCommand,
  type IntentRevertCommand,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { migrateRuntimeDatabase } from "../src/runtime-app.js";

const databaseUrl = process.env.DATABASE_URL;

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

function correction(
  scopeId: string,
  id: string,
  turn: number,
  baseIntentVersionId: string,
  correctsIntentVersionId: string,
  operations: IntentCorrectionCommand["operations"],
): IntentCorrectionCommand {
  return {
    transitionId: id,
    intentScopeId: scopeId,
    baseIntentVersionId,
    correctsIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
    operations,
  };
}

function revert(
  scopeId: string,
  id: string,
  turn: number,
  baseIntentVersionId: string,
  revertsIntentVersionId: string,
): IntentRevertCommand {
  return {
    transitionId: id,
    intentScopeId: scopeId,
    baseIntentVersionId,
    revertsIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
  };
}

function reset(scopeId: string, id: string, turn: number, baseIntentVersionId: string): IntentResetCommand {
  return {
    transitionId: id,
    intentScopeId: scopeId,
    baseIntentVersionId,
    logicalUserTurnId: `turn-${turn}`,
    observedMessageHorizon: turn,
    sourceMessageId: `message-${turn}`,
    sourceDigest: `digest-${turn}`,
  };
}

test("PostgreSQL Intent Authority persists correction, revert, and reset lineage across restart", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);
  const scopeId = `intent-lineage-${randomUUID()}`;
  const pool = new Pool({ connectionString: databaseUrl });
  const ids = ["lineage-v1", "lineage-v2", "lineage-v3", "lineage-v4", "lineage-v5"];
  let store = await PostgresIntentAuthorityStore.connect(databaseUrl, {
    migrate: false,
    idFactory: () => ids.shift() ?? `unexpected-${randomUUID()}`,
  });
  try {
    await store.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, "lineage-t1", 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
        { op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1300 } },
      ]),
    });
    await store.applyTransition(transition(scopeId, "lineage-t2", 2, "lineage-v1", [
      { op: "SET", path: { kind: "PREFERENCE", key: "performance" }, value: { state: "OPEN" } },
    ]));

    assert.equal((await store.applyCorrection(correction(
      scopeId,
      "lineage-t3",
      3,
      "lineage-v2",
      "lineage-v1",
      [{ op: "SET", path: { kind: "REQUIREMENT", key: "budget" }, value: { state: "VALUE", value: 1500 } }],
    ))).disposition, "COMMITTED");

    const rejected = revert(scopeId, "lineage-t4", 4, "lineage-v3", "lineage-v1");
    assert.equal((await store.revertVersion(rejected)).disposition, "REJECTED_INVALID");
    const rejectedReplay = await store.revertVersion(rejected);
    assert.equal(rejectedReplay.disposition, "REPLAYED");
    assert.equal(rejectedReplay.replayedDisposition, "REJECTED_INVALID");

    assert.equal((await store.revertVersion(revert(
      scopeId,
      "lineage-t5",
      5,
      "lineage-v3",
      "lineage-v2",
    ))).disposition, "COMMITTED");
    assert.equal((await store.resetScope(reset(scopeId, "lineage-t6", 6, "lineage-v4"))).disposition, "COMMITTED");

    const v1 = await store.getVersion("lineage-v1");
    const v3 = await store.getVersion("lineage-v3");
    const v4 = await store.getVersion("lineage-v4");
    const v5 = await store.getVersion("lineage-v5");
    assert.equal(v1?.lineageKind, "INITIAL");
    assert.equal(v3?.lineageKind, "CORRECTION");
    assert.equal(v3?.lineageTargetIntentVersionId, "lineage-v1");
    assert.equal(v4?.lineageKind, "REVERT");
    assert.equal(v4?.lineageTargetIntentVersionId, "lineage-v2");
    assert.equal(v5?.lineageKind, "RESET_SUPERSEDES");
    assert.equal(v5?.lineageTargetIntentVersionId, "lineage-v4");
    assert.deepEqual(v5?.state, emptyIntentState());
    assert.equal(
      (readIntentValue(v4?.state ?? emptyIntentState(), { kind: "REQUIREMENT", key: "budget" }) as { state: "VALUE"; value: number }).value,
      1500,
    );
    assert.equal(readIntentValue(v4?.state ?? emptyIntentState(), { kind: "PREFERENCE", key: "performance" }).state, "UNSPECIFIED");

    await store.close();
    store = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
    const restored = await store.getScope(scopeId);
    assert.equal(restored?.currentIntentVersionId, "lineage-v5");
    const restoredReset = await store.getVersion("lineage-v5");
    assert.equal(restoredReset?.lineageKind, "RESET_SUPERSEDES");
    assert.equal(restoredReset?.lineageTargetIntentVersionId, "lineage-v4");
    assert.deepEqual(restoredReset?.state, emptyIntentState());

    const counts = await pool.query<{
      versions: string;
      lineage_transitions: string;
      migration: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM intent_versions WHERE intent_scope_id=$1) AS versions,
         (SELECT count(*)::text FROM intent_transitions
          WHERE intent_scope_id=$1 AND lineage_kind IN ('CORRECTION','REVERT','RESET_SUPERSEDES')) AS lineage_transitions,
         (SELECT count(*)::text FROM schema_migrations WHERE name='024_intent_version_lineage.sql') AS migration`,
      [scopeId],
    );
    assert.equal(counts.rows[0]?.versions, "5");
    assert.equal(counts.rows[0]?.lineage_transitions, "4");
    assert.equal(counts.rows[0]?.migration, "1");
  } finally {
    await store.close();
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
