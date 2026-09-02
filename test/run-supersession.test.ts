import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { RunRequest } from "../src/domain.js";
import {
  MemoryIntentAuthorityStore,
  MemoryIntentBoundRunStore,
  PostgresIntentAuthorityStore,
  PostgresIntentBoundRunStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { PostgresRunStore } from "../src/postgres-run-store.js";
import { createPendingRun } from "../src/run-execution.js";
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

test("memory material-correction supersession preserves historical binding and starts a clean successor", async () => {
  const scopeId = "scope-supersession-memory";
  const ids = ["intent-v1", "intent-v2"];
  const intentStore = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected-version");
  const runStore = new MemoryRunStore();
  const boundRuns = new MemoryIntentBoundRunStore(runStore, intentStore);
  try {
    const scope = await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, "transition-1", 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });
    const predecessorId = randomUUID();
    await boundRuns.create(createPendingRun("conversation-1", request, predecessorId), {
      intentScopeId: scopeId,
      intentVersionId: scope.currentIntentVersionId,
    });
    const advancedRun = await runStore.transition({
      runId: predecessorId,
      expectedStatus: "CREATED",
      expectedVersion: 1,
      nextStatus: "UNDERSTANDING",
    });
    assert.deepEqual(advancedRun, { outcome: "advanced", version: 2 });

    const advancedIntent = await intentStore.applyTransition(transition(
      scopeId,
      "transition-2",
      2,
      scope.currentIntentVersionId,
      [{ op: "SET", path: { kind: "PREFERENCE", key: "battery" }, value: { state: "VALUE", value: 12 } }],
    ));
    assert.equal(advancedIntent.disposition, "COMMITTED");
    assert.equal(advancedIntent.resultingIntentVersionId, "intent-v2");

    const successorId = randomUUID();
    const successorRun = createPendingRun("conversation-1", request, successorId);
    const stale = await boundRuns.supersede({
      supersessionId: "supersession-stale",
      predecessorRunId: predecessorId,
      expectedPredecessorStatus: "UNDERSTANDING",
      expectedPredecessorVersion: 99,
      successorRun,
      successorBinding: { intentScopeId: scopeId, intentVersionId: "intent-v2" },
    });
    assert.deepEqual(stale, { outcome: "stale" });
    assert.equal(await runStore.get(successorId), undefined);

    const result = await boundRuns.supersede({
      supersessionId: "supersession-1",
      predecessorRunId: predecessorId,
      expectedPredecessorStatus: "UNDERSTANDING",
      expectedPredecessorVersion: 2,
      successorRun,
      successorBinding: { intentScopeId: scopeId, intentVersionId: "intent-v2" },
    });
    assert.equal(result.outcome, "superseded");
    if (result.outcome !== "superseded") throw new Error("Expected superseded result.");
    assert.equal(result.record.predecessorIntentVersionId, "intent-v1");
    assert.equal(result.record.successorIntentVersionId, "intent-v2");

    assert.equal((await runStore.get(predecessorId))?.status, "CANCELLED");
    assert.deepEqual((await runStore.get(predecessorId))?.events.map((event) => event.type), [
      "CREATED",
      "UNDERSTANDING",
      "CANCELLED",
    ]);
    assert.equal((await boundRuns.getBinding(predecessorId))?.intentVersionId, "intent-v1");
    assert.equal((await boundRuns.getBinding(successorId))?.intentVersionId, "intent-v2");
    const successor = await runStore.get(successorId);
    assert.equal(successor?.status, "CREATED");
    assert.equal(successor?.decision, null);
    assert.deepEqual(successor?.truthAssessmentIds, []);
    assert.equal(await runStore.getTruthBundle(successorId), undefined);

    const replay = await boundRuns.supersede({
      supersessionId: "supersession-1",
      predecessorRunId: predecessorId,
      expectedPredecessorStatus: "UNDERSTANDING",
      expectedPredecessorVersion: 2,
      successorRun,
      successorBinding: { intentScopeId: scopeId, intentVersionId: "intent-v2" },
    });
    assert.equal(replay.outcome, "replayed");
    assert.deepEqual(await boundRuns.getSupersession(predecessorId), result.record);
    assert.equal((await runStore.get(predecessorId))?.version, 3);
  } finally {
    await boundRuns.close();
    await runStore.close();
    await intentStore.close();
  }
});

test("PostgreSQL material-correction supersession is atomic and does not transfer prior Run state", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const scopeId = `scope-supersession-${randomUUID()}`;
  const predecessorId = randomUUID();
  const rejectedPredecessorId = randomUUID();
  const successorId = randomUUID();
  const rejectedSuccessorId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const boundRuns = await PostgresIntentBoundRunStore.connect(databaseUrl, { migrate: false });
  const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  try {
    const scope = await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, randomUUID(), 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });
    const v1 = scope.currentIntentVersionId;
    await boundRuns.create(createPendingRun("conversation-pg", request, predecessorId), {
      intentScopeId: scopeId,
      intentVersionId: v1,
    });
    await boundRuns.create(createPendingRun("conversation-pg-rejected", request, rejectedPredecessorId), {
      intentScopeId: scopeId,
      intentVersionId: v1,
    });

    const advancedIntent = await intentStore.applyTransition(transition(
      scopeId,
      randomUUID(),
      2,
      v1,
      [{ op: "SET", path: { kind: "PREFERENCE", key: "battery" }, value: { state: "VALUE", value: 12 } }],
    ));
    assert.equal(advancedIntent.disposition, "COMMITTED");
    const v2 = advancedIntent.resultingIntentVersionId;
    assert.ok(v2);

    await assert.rejects(
      boundRuns.supersede({
        supersessionId: `rejected-${randomUUID()}`,
        predecessorRunId: rejectedPredecessorId,
        expectedPredecessorStatus: "CREATED",
        expectedPredecessorVersion: 1,
        successorRun: createPendingRun("conversation-pg-rejected", request, rejectedSuccessorId),
        successorBinding: { intentScopeId: scopeId, intentVersionId: "missing-version" },
      }),
      /existing exact IntentVersion/,
    );
    assert.equal((await runStore.get(rejectedPredecessorId))?.status, "CREATED");
    assert.equal(await runStore.get(rejectedSuccessorId), undefined);

    const input = {
      supersessionId: `supersession-${randomUUID()}`,
      predecessorRunId: predecessorId,
      expectedPredecessorStatus: "CREATED" as const,
      expectedPredecessorVersion: 1,
      successorRun: createPendingRun("conversation-pg", request, successorId),
      successorBinding: { intentScopeId: scopeId, intentVersionId: v2 },
    };
    const result = await boundRuns.supersede(input);
    assert.equal(result.outcome, "superseded");
    if (result.outcome !== "superseded") throw new Error("Expected superseded result.");

    const replay = await boundRuns.supersede(input);
    assert.equal(replay.outcome, "replayed");
    assert.equal((await runStore.get(predecessorId))?.status, "CANCELLED");
    assert.equal((await boundRuns.getBinding(predecessorId))?.intentVersionId, v1);
    assert.equal((await boundRuns.getBinding(successorId))?.intentVersionId, v2);

    const successor = await runStore.get(successorId);
    assert.equal(successor?.status, "CREATED");
    assert.equal(successor?.decision, null);
    assert.deepEqual(successor?.truthAssessmentIds, []);
    assert.equal(await runStore.getTruthSnapshot(successorId), undefined);

    const durable = await pool.query<{
      supersessions: string;
      successor_truth: string;
      migration: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM run_supersessions WHERE predecessor_run_id=$1) AS supersessions,
         (SELECT count(*)::text FROM truth_snapshot_state WHERE run_id=$2) AS successor_truth,
         (SELECT count(*)::text FROM schema_migrations WHERE name='026_run_supersessions.sql') AS migration`,
      [predecessorId, successorId],
    );
    assert.equal(durable.rows[0]?.supersessions, "1");
    assert.equal(durable.rows[0]?.successor_truth, "0");
    assert.equal(durable.rows[0]?.migration, "1");
  } finally {
    await pool.query("DELETE FROM run_supersessions WHERE predecessor_run_id = ANY($1::uuid[])", [
      [predecessorId, rejectedPredecessorId],
    ]);
    await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [
      [predecessorId, rejectedPredecessorId, successorId, rejectedSuccessorId],
    ]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await runStore.close();
    await boundRuns.close();
    await intentStore.close();
    await pool.end();
  }
});
