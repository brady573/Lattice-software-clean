import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { MemoryApiRunControlStore } from "../src/api-control-store.js";
import type { RunRequest } from "../src/domain.js";
import {
  MemoryIntentAuthorityStore,
  MemoryIntentBoundRunStore,
  PostgresIntentAuthorityStore,
  type IntentTransitionCommand,
} from "../src/intent/index.js";
import { PostgresApiRunControlStore } from "../src/postgres-api-control-store.js";
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

test("memory API control supersession preserves exact lineage and replays without a second successor", async () => {
  const scopeId = "scope-api-supersession-memory";
  const ids = ["intent-api-super-v1", "intent-api-super-v2"];
  const intentStore = new MemoryIntentAuthorityStore(() => ids.shift() ?? "unexpected-version");
  const runStore = new MemoryRunStore();
  const boundRuns = new MemoryIntentBoundRunStore(runStore, intentStore);
  const control = new MemoryApiRunControlStore(runStore, boundRuns);
  try {
    const scope = await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, "transition-1", 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });
    const predecessorId = randomUUID();
    await control.submitRun({
      run: createPendingRun("conversation-api-super", request, predecessorId),
      intentBinding: { intentScopeId: scopeId, intentVersionId: scope.currentIntentVersionId },
      dispatch: { logicalKey: `run:${predecessorId}:execute`, queueName: "lattice.run", payload: { runId: predecessorId } },
    });

    const successorIntent = await intentStore.applyTransition(transition(
      scopeId,
      "transition-2",
      2,
      scope.currentIntentVersionId,
      [{ op: "SET", path: { kind: "PREFERENCE", key: "battery" }, value: { state: "VALUE", value: 12 } }],
    ));
    assert.equal(successorIntent.disposition, "COMMITTED");
    const successorIntentVersionId = successorIntent.resultingIntentVersionId;
    assert.ok(successorIntentVersionId);

    const successorId = randomUUID();
    const input = {
      supersession: {
        supersessionId: "api-supersession-memory-1",
        predecessorRunId: predecessorId,
        expectedPredecessorStatus: "CREATED" as const,
        expectedPredecessorVersion: 1,
        successorRun: createPendingRun("conversation-api-super", request, successorId),
        successorBinding: { intentScopeId: scopeId, intentVersionId: successorIntentVersionId },
      },
      dispatch: { logicalKey: `run:${successorId}:execute`, queueName: "lattice.run", payload: { runId: successorId } },
    };

    const superseded = await control.supersedeRun(input);
    assert.equal(superseded.outcome, "superseded");
    if (superseded.outcome !== "superseded") throw new Error("Expected superseded result.");
    assert.equal(superseded.response.runId, successorId);
    assert.equal(superseded.response.supersededRunId, predecessorId);
    assert.equal((await runStore.get(predecessorId))?.status, "CANCELLED");
    assert.equal((await boundRuns.getBinding(predecessorId))?.intentVersionId, "intent-api-super-v1");
    assert.equal((await boundRuns.getBinding(successorId))?.intentVersionId, "intent-api-super-v2");

    const replayed = await control.supersedeRun(input);
    assert.equal(replayed.outcome, "replayed");
    assert.equal(replayed.outcome === "replayed" ? replayed.response.runId : undefined, successorId);
    assert.equal((await runStore.get(predecessorId))?.version, 2);
  } finally {
    await control.close();
    await runStore.close();
    await intentStore.close();
  }
});

test("PostgreSQL API control supersession atomically persists successor dispatch and rolls back invalid exact binding", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const scopeId = `scope-api-super-${randomUUID()}`;
  const predecessorId = randomUUID();
  const rejectedPredecessorId = randomUUID();
  const successorId = randomUUID();
  const rejectedSuccessorId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const control = await PostgresApiRunControlStore.connect(databaseUrl, { migrate: false });
  try {
    const scope = await intentStore.createScope({
      intentScopeId: scopeId,
      initialTransition: transition(scopeId, randomUUID(), 1, null, [
        { op: "SET", path: { kind: "OBJECTIVE" }, value: { state: "VALUE", value: "choose a laptop" } },
      ]),
    });
    const v1 = scope.currentIntentVersionId;

    for (const [conversationId, runId] of [
      ["conversation-api-super", predecessorId],
      ["conversation-api-super-rejected", rejectedPredecessorId],
    ] as const) {
      await control.submitRun({
        run: createPendingRun(conversationId, request, runId),
        intentBinding: { intentScopeId: scopeId, intentVersionId: v1 },
        dispatch: { logicalKey: `run:${runId}:execute`, queueName: "lattice.run", payload: { runId } },
      });
    }

    const successorIntent = await intentStore.applyTransition(transition(
      scopeId,
      randomUUID(),
      2,
      v1,
      [{ op: "SET", path: { kind: "PREFERENCE", key: "battery" }, value: { state: "VALUE", value: 12 } }],
    ));
    assert.equal(successorIntent.disposition, "COMMITTED");
    const v2 = successorIntent.resultingIntentVersionId;
    assert.ok(v2);

    await assert.rejects(
      control.supersedeRun({
        supersession: {
          supersessionId: `api-super-rejected-${randomUUID()}`,
          predecessorRunId: rejectedPredecessorId,
          expectedPredecessorStatus: "CREATED",
          expectedPredecessorVersion: 1,
          successorRun: createPendingRun("conversation-api-super-rejected", request, rejectedSuccessorId),
          successorBinding: { intentScopeId: scopeId, intentVersionId: "missing-version" },
        },
        dispatch: {
          logicalKey: `run:${rejectedSuccessorId}:execute`,
          queueName: "lattice.run",
          payload: { runId: rejectedSuccessorId },
        },
      }),
      /existing exact IntentVersion/,
    );
    const rejectedState = await pool.query<{ status: string; successor: string; dispatches: string }>(
      `SELECT
         (SELECT status FROM runs WHERE id=$1) AS status,
         (SELECT count(*)::text FROM runs WHERE id=$2) AS successor,
         (SELECT count(*)::text FROM dispatch_outbox WHERE run_id=$2) AS dispatches`,
      [rejectedPredecessorId, rejectedSuccessorId],
    );
    assert.equal(rejectedState.rows[0]?.status, "CREATED");
    assert.equal(rejectedState.rows[0]?.successor, "0");
    assert.equal(rejectedState.rows[0]?.dispatches, "0");

    const input = {
      supersession: {
        supersessionId: `api-super-${randomUUID()}`,
        predecessorRunId: predecessorId,
        expectedPredecessorStatus: "CREATED" as const,
        expectedPredecessorVersion: 1,
        successorRun: createPendingRun("conversation-api-super", request, successorId),
        successorBinding: { intentScopeId: scopeId, intentVersionId: v2 },
      },
      dispatch: {
        logicalKey: `run:${successorId}:execute`,
        queueName: "lattice.run",
        payload: { runId: successorId, submittedVersion: 1 },
      },
    };
    const superseded = await control.supersedeRun(input);
    assert.equal(superseded.outcome, "superseded");
    const replayed = await control.supersedeRun(input);
    assert.equal(replayed.outcome, "replayed");

    const durable = await pool.query<{
      predecessor_status: string;
      predecessor_binding: string;
      successor_binding: string;
      supersessions: string;
      successor_dispatches: string;
      successor_truth: string;
    }>(
      `SELECT
         (SELECT status FROM runs WHERE id=$1) AS predecessor_status,
         (SELECT intent_version_id FROM run_intent_bindings WHERE run_id=$1) AS predecessor_binding,
         (SELECT intent_version_id FROM run_intent_bindings WHERE run_id=$2) AS successor_binding,
         (SELECT count(*)::text FROM run_supersessions WHERE predecessor_run_id=$1) AS supersessions,
         (SELECT count(*)::text FROM dispatch_outbox WHERE run_id=$2) AS successor_dispatches,
         (SELECT count(*)::text FROM truth_snapshot_state WHERE run_id=$2) AS successor_truth`,
      [predecessorId, successorId],
    );
    assert.equal(durable.rows[0]?.predecessor_status, "CANCELLED");
    assert.equal(durable.rows[0]?.predecessor_binding, v1);
    assert.equal(durable.rows[0]?.successor_binding, v2);
    assert.equal(durable.rows[0]?.supersessions, "1");
    assert.equal(durable.rows[0]?.successor_dispatches, "1");
    assert.equal(durable.rows[0]?.successor_truth, "0");
  } finally {
    await pool.query("DELETE FROM run_supersessions WHERE predecessor_run_id = ANY($1::uuid[])", [[predecessorId, rejectedPredecessorId]]);
    await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [[predecessorId, rejectedPredecessorId, successorId, rejectedSuccessorId]]);
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await control.close();
    await intentStore.close();
    await pool.end();
  }
});
