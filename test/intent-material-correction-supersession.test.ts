import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { MemoryApiRunControlStore } from "../src/api-control-store.js";
import { buildApp } from "../src/app.js";
import { registerBoundedDecisionCorrection } from "../src/intent/bounded-decision-correction.js";
import { registerBoundedDecisionIntentIntake } from "../src/intent/bounded-decision-intake.js";
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
const initialContent = "I need a tablet under $1,300. I'd like at least 12 hours of battery life, but performance matters more.";
const correctionContent = "Actually, make the budget $1,100.";

async function createBoundedRun(app: ReturnType<typeof buildApp>, conversationId: string, scopeId: string) {
  const initial = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/user-messages`,
    payload: { turnId: "turn-1", messageId: "message-1", content: initialContent },
  });
  assert.equal(initial.statusCode, 202);
  const pending = initial.json() as { proposalId: string; intentVersionId: string };

  const confirmation = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clarifications/${pending.proposalId}/confirm`,
    payload: { turnId: "turn-2", messageId: "message-2", content: "Hard requirement." },
  });
  assert.equal(confirmation.statusCode, 202);
  return {
    v1Id: pending.intentVersionId,
    v2Id: confirmation.json().intentVersionId as string,
    runId: confirmation.json().runId as string,
  };
}

test("material USER budget correction creates immutable IntentVersion and supersedes the exact memory Run", async () => {
  const conversationId = "conversation-m5j-memory";
  const scopeId = "scope-m5j-memory";
  const intentStore = new MemoryIntentAuthorityStore();
  const userMessages = new MemoryIntentUserMessageStore();
  const runStore = new MemoryRunStore();
  const boundRuns = new MemoryIntentBoundRunStore(runStore, intentStore);
  const control = new MemoryApiRunControlStore(runStore, boundRuns);
  const app = buildApp({ runStore, apiControlStore: control });
  registerBoundedDecisionIntentIntake(app, {
    intentStore,
    userMessageStore: userMessages,
    apiControlStore: control,
  });
  registerBoundedDecisionCorrection(app, {
    intentStore,
    userMessageStore: userMessages,
    apiControlStore: control,
    runStore,
  });

  try {
    const created = await createBoundedRun(app, conversationId, scopeId);
    const predecessorBefore = await runStore.get(created.runId);
    assert.equal(predecessorBefore?.status, "CREATED");
    assert.equal(predecessorBefore?.version, 1);

    const correction = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/runs/${created.runId}/corrections`,
      payload: { turnId: "turn-3", messageId: "message-3", content: correctionContent },
    });
    assert.equal(correction.statusCode, 202);
    const accepted = correction.json() as {
      status: string;
      runId: string;
      supersededRunId: string;
      supersessionId: string;
      predecessorIntentVersionId: string;
      intentVersionId: string;
    };
    assert.equal(accepted.status, "RUN_SUPERSEDED");
    assert.equal(accepted.supersededRunId, created.runId);
    assert.equal(accepted.predecessorIntentVersionId, created.v2Id);
    assert.notEqual(accepted.intentVersionId, created.v2Id);

    const persistedCorrection = await userMessages.get("message-3");
    assert.equal(persistedCorrection?.origin, "USER");
    assert.equal(persistedCorrection?.messageHorizon, 3);
    assert.equal(persistedCorrection?.content, correctionContent);

    const v3 = await intentStore.getVersion(accepted.intentVersionId);
    assert.equal(v3?.version, 3);
    assert.equal(v3?.predecessorIntentVersionId, created.v2Id);
    assert.equal(v3?.lineageKind, "CORRECTION");
    assert.equal(v3?.lineageTargetIntentVersionId, created.v1Id);
    assert.deepEqual(v3?.state.requirements["price.max.usd"]?.value, { state: "VALUE", value: 1100 });
    assert.equal(v3?.state.requirements["price.max.usd"]?.provenance.kind, "EXPLICIT_USER");
    assert.deepEqual(v3?.state.requirements["batteryHours.min"]?.value, { state: "VALUE", value: 12 });

    const predecessorAfter = await runStore.get(created.runId);
    assert.equal(predecessorAfter?.status, "CANCELLED");
    assert.equal(predecessorAfter?.version, 2);
    const historicalBinding = await boundRuns.getBinding(created.runId);
    assert.equal(historicalBinding?.intentVersionId, created.v2Id);

    const successor = await runStore.get(accepted.runId);
    assert.equal(successor?.status, "CREATED");
    assert.equal(successor?.version, 1);
    assert.equal(successor?.request.goal, "Choose a tablet under $1100 with at least 12 hours of battery life, prioritizing performance.");
    assert.deepEqual(successor?.request.hardConstraints, [
      { criterion: "price", operator: "lte", value: 1100 },
      { criterion: "batteryHours", operator: "gte", value: 12 },
    ]);
    const successorBinding = await boundRuns.getBinding(accepted.runId);
    assert.equal(successorBinding?.intentScopeId, scopeId);
    assert.equal(successorBinding?.intentVersionId, accepted.intentVersionId);

    const lineage = await boundRuns.getSupersession(created.runId);
    assert.equal(lineage?.supersessionId, accepted.supersessionId);
    assert.equal(lineage?.predecessorIntentVersionId, created.v2Id);
    assert.equal(lineage?.successorIntentVersionId, accepted.intentVersionId);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/runs/${created.runId}/corrections`,
      payload: { turnId: "turn-3", messageId: "message-3", content: correctionContent },
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, accepted.runId);
    assert.equal(replay.json().supersessionId, accepted.supersessionId);

    const unsupported = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/runs/${accepted.runId}/corrections`,
      payload: { turnId: "turn-4", messageId: "message-4", content: "Actually, battery matters more now." },
    });
    assert.equal(unsupported.statusCode, 422);
    assert.equal(unsupported.json().error, "BOUNDED_CORRECTION_NOT_REPRESENTABLE");
    assert.equal(await userMessages.get("message-4"), undefined);
  } finally {
    await app.close();
    await intentStore.close();
    await userMessages.close();
  }
});

test("PostgreSQL material correction persists exact IntentVersion and Run supersession lineage", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const conversationId = `conversation-m5j-${randomUUID()}`;
  const scopeId = `scope-m5j-${randomUUID()}`;
  const initialTurnId = randomUUID();
  const initialMessageId = randomUUID();
  const confirmationTurnId = randomUUID();
  const confirmationMessageId = randomUUID();
  const correctionTurnId = randomUUID();
  const correctionMessageId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  const intentStore = await PostgresIntentAuthorityStore.connect(databaseUrl, { migrate: false });
  const userMessages = await PostgresIntentUserMessageStore.connect(databaseUrl, { migrate: false });
  const runStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const control = await PostgresApiRunControlStore.connect(databaseUrl, { migrate: false });
  const app = buildApp({ runStore, apiControlStore: control });
  registerBoundedDecisionIntentIntake(app, {
    intentStore,
    userMessageStore: userMessages,
    apiControlStore: control,
  });
  registerBoundedDecisionCorrection(app, {
    intentStore,
    userMessageStore: userMessages,
    apiControlStore: control,
    runStore,
  });

  let predecessorRunId: string | undefined;
  let successorRunId: string | undefined;
  try {
    const initial = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/user-messages`,
      payload: { turnId: initialTurnId, messageId: initialMessageId, content: initialContent },
    });
    assert.equal(initial.statusCode, 202);
    const pending = initial.json() as { proposalId: string; intentVersionId: string };

    const confirmation = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clarifications/${pending.proposalId}/confirm`,
      payload: { turnId: confirmationTurnId, messageId: confirmationMessageId, content: "Hard requirement." },
    });
    assert.equal(confirmation.statusCode, 202);
    predecessorRunId = confirmation.json().runId as string;
    const predecessorIntentVersionId = confirmation.json().intentVersionId as string;

    const correction = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/runs/${predecessorRunId}/corrections`,
      payload: { turnId: correctionTurnId, messageId: correctionMessageId, content: correctionContent },
    });
    assert.equal(correction.statusCode, 202);
    successorRunId = correction.json().runId as string;
    const successorIntentVersionId = correction.json().intentVersionId as string;

    const persisted = await pool.query<{
      predecessor_status: string;
      predecessor_version: string;
      predecessor_intent_version_id: string;
      successor_status: string;
      successor_version: string;
      successor_intent_version_id: string;
      successor_dispatches: string;
      user_messages: string;
      correction_lineage_kind: string;
      correction_lineage_target: string;
    }>(
      `SELECT p.status AS predecessor_status,p.version AS predecessor_version,
         pb.intent_version_id AS predecessor_intent_version_id,
         s.status AS successor_status,s.version AS successor_version,
         sb.intent_version_id AS successor_intent_version_id,
         (SELECT count(*)::text FROM dispatch_outbox d WHERE d.run_id=s.id) AS successor_dispatches,
         (SELECT count(*)::text FROM intent_user_messages m WHERE m.intent_scope_id=pb.intent_scope_id) AS user_messages,
         iv.lineage_kind AS correction_lineage_kind,
         iv.lineage_target_intent_version_id AS correction_lineage_target
       FROM run_supersessions rs
       JOIN runs p ON p.id=rs.predecessor_run_id
       JOIN runs s ON s.id=rs.successor_run_id
       JOIN run_intent_bindings pb ON pb.run_id=p.id
       JOIN run_intent_bindings sb ON sb.run_id=s.id
       JOIN intent_versions iv ON iv.intent_version_id=sb.intent_version_id
       WHERE rs.predecessor_run_id=$1 AND rs.successor_run_id=$2`,
      [predecessorRunId, successorRunId],
    );
    assert.equal(persisted.rows[0]?.predecessor_status, "CANCELLED");
    assert.equal(persisted.rows[0]?.predecessor_version, "2");
    assert.equal(persisted.rows[0]?.predecessor_intent_version_id, predecessorIntentVersionId);
    assert.equal(persisted.rows[0]?.successor_status, "CREATED");
    assert.equal(persisted.rows[0]?.successor_version, "1");
    assert.equal(persisted.rows[0]?.successor_intent_version_id, successorIntentVersionId);
    assert.equal(persisted.rows[0]?.successor_dispatches, "1");
    assert.equal(persisted.rows[0]?.user_messages, "3");
    assert.equal(persisted.rows[0]?.correction_lineage_kind, "CORRECTION");
    assert.equal(persisted.rows[0]?.correction_lineage_target, pending.intentVersionId);

    const exactVersion = await intentStore.getVersion(successorIntentVersionId);
    assert.deepEqual(exactVersion?.state.requirements["price.max.usd"]?.value, { state: "VALUE", value: 1100 });
    assert.deepEqual(exactVersion?.state.requirements["batteryHours.min"]?.value, { state: "VALUE", value: 12 });

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/runs/${predecessorRunId}/corrections`,
      payload: { turnId: correctionTurnId, messageId: correctionMessageId, content: correctionContent },
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, successorRunId);
  } finally {
    await app.close();
    await intentStore.close();
    await userMessages.close();
    if (predecessorRunId && successorRunId) {
      await pool.query("DELETE FROM run_supersessions WHERE predecessor_run_id=$1 OR successor_run_id=$2", [predecessorRunId, successorRunId]);
      await pool.query("DELETE FROM runs WHERE id = ANY($1::uuid[])", [[predecessorRunId, successorRunId]]);
    } else if (predecessorRunId) {
      await pool.query("DELETE FROM runs WHERE id=$1", [predecessorRunId]);
    }
    await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [scopeId]);
    await pool.query("DELETE FROM intent_user_messages WHERE intent_scope_id=$1", [scopeId]);
    await pool.end();
  }
});
