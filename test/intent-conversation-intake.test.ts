import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { MemoryApiRunControlStore } from "../src/api-control-store.js";
import { buildApp } from "../src/app.js";
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
import { createRuntimeApp, migrateRuntimeDatabase } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const databaseUrl = process.env.DATABASE_URL;
const initialContent = "I need a tablet under $1,300. I'd like at least 12 hours of battery life, but performance matters more.";

function initialPayload() {
  return {
    turnId: "turn-1",
    messageId: "message-1",
    content: initialContent,
  };
}

function confirmationPayload() {
  return {
    turnId: "turn-2",
    messageId: "message-2",
    content: "Hard requirement.",
  };
}

test("runtime canonical conversation API creates an exact IntentVersion", async () => {
  const app = await createRuntimeApp(
    resolveRuntimeConfig({
      PORT: "3000",
      HOST: "127.0.0.1",
      LATTICE_DEPLOYMENT_MODE: "development",
      LATTICE_AUTO_MIGRATE: "false",
      LATTICE_AUTHENTICATION_MODE: "development-fixture",
    }),
  );

  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201);
    const conversationId = (created.json() as { conversation: { id: string } }).conversation.id;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "turn-1", message: initialContent },
    });
    assert.equal(response.statusCode, 202);
    const accepted = response.json() as { status: string; intentScopeId: string; intentVersionId: string };
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.equal(accepted.intentScopeId, `consultation:${conversationId}`);
    assert.match(accepted.intentVersionId, /^[0-9a-f-]{36}$/u);
  } finally {
    await app.close();
  }
});

test("bounded USER message becomes exact clarified IntentVersion before memory Run intake", async () => {
  const conversationId = "conversation-m5i-memory";
  const scopeId = "scope-m5i-memory";
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

  try {
    const initial = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/user-messages`,
      payload: initialPayload(),
    });
    assert.equal(initial.statusCode, 202);
    const pendingResponse = initial.json() as {
      status: string;
      intentVersionId: string;
      proposalId: string;
      proposalDigest: string;
    };
    assert.equal(pendingResponse.status, "NEEDS_CLARIFICATION");

    const persistedInitial = await userMessages.get("message-1");
    assert.equal(persistedInitial?.origin, "USER");
    assert.equal(persistedInitial?.content, initialContent);
    assert.equal(persistedInitial?.messageHorizon, 1);

    const v1 = await intentStore.getVersion(pendingResponse.intentVersionId);
    assert.equal(v1?.version, 1);
    assert.deepEqual(v1?.state.objective?.value, { state: "VALUE", value: "choose a tablet" });
    assert.deepEqual(v1?.state.requirements["price.max.usd"]?.value, { state: "VALUE", value: 1300 });
    assert.equal(v1?.state.requirements["batteryHours.min"], undefined);
    assert.deepEqual(
      v1?.state.preferences["performance.relativeToBattery"]?.value,
      { state: "VALUE", value: "MORE_IMPORTANT" },
    );

    const pending = await intentStore.getPendingProposal(pendingResponse.proposalId);
    assert.equal(pending?.status, "PENDING");
    assert.equal(pending?.proposalDigest, pendingResponse.proposalDigest);
    assert.equal((await intentStore.getScope(scopeId))?.currentIntentVersionId, pendingResponse.intentVersionId);

    const confirm = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clarifications/${pendingResponse.proposalId}/confirm`,
      payload: confirmationPayload(),
    });
    assert.equal(confirm.statusCode, 202);
    const accepted = confirm.json() as {
      status: string;
      runId: string;
      intentVersionId: string;
    };
    assert.equal(accepted.status, "RUN_ACCEPTED");
    assert.notEqual(accepted.intentVersionId, pendingResponse.intentVersionId);

    const v2 = await intentStore.getVersion(accepted.intentVersionId);
    const battery = v2?.state.requirements["batteryHours.min"];
    assert.deepEqual(battery?.value, { state: "VALUE", value: 12 });
    assert.equal(battery?.provenance.kind, "USER_CONFIRMED");
    if (battery?.provenance.kind === "USER_CONFIRMED") {
      assert.equal(battery.provenance.proposalId, pendingResponse.proposalId);
      assert.equal(battery.provenance.proposalDigest, pendingResponse.proposalDigest);
    }
    assert.equal((await intentStore.getPendingProposal(pendingResponse.proposalId))?.status, "CONFIRMED");

    const persistedConfirmation = await userMessages.get("message-2");
    assert.equal(persistedConfirmation?.origin, "USER");
    assert.equal(persistedConfirmation?.messageHorizon, 2);

    const binding = await boundRuns.getBinding(accepted.runId);
    assert.equal(binding?.intentScopeId, scopeId);
    assert.equal(binding?.intentVersionId, accepted.intentVersionId);
    const run = await runStore.get(accepted.runId);
    assert.equal(run?.request.goal, "Choose a tablet under $1300 with at least 12 hours of battery life, prioritizing performance.");
    assert.deepEqual(run?.request.hardConstraints, [
      { criterion: "price", operator: "lte", value: 1300 },
      { criterion: "batteryHours", operator: "gte", value: 12 },
    ]);
    assert.deepEqual(run?.request.priorities, [{ criterion: "performance", weight: 1 }]);

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clarifications/${pendingResponse.proposalId}/confirm`,
      payload: confirmationPayload(),
    });
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().runId, accepted.runId);

    const unsupportedScope = "scope-m5i-unsupported";
    const unsupported = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${unsupportedScope}/user-messages`,
      payload: {
        turnId: "unsupported-turn",
        messageId: "unsupported-message",
        content: "I want a great travel tablet, use your judgment.",
      },
    });
    assert.equal(unsupported.statusCode, 422);
    assert.equal(unsupported.json().error, "BOUNDED_INTENT_NOT_REPRESENTABLE");
    assert.equal(await intentStore.getScope(unsupportedScope), undefined);
    assert.equal(await userMessages.get("unsupported-message"), undefined);
  } finally {
    await app.close();
    await intentStore.close();
    await userMessages.close();
  }
});

test("PostgreSQL bounded conversational intake persists USER provenance and exact Run binding", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await migrateRuntimeDatabase(databaseUrl);

  const conversationId = `conversation-m5i-${randomUUID()}`;
  const scopeId = `scope-m5i-${randomUUID()}`;
  const initialMessageId = randomUUID();
  const confirmationMessageId = randomUUID();
  const initialTurnId = randomUUID();
  const confirmationTurnId = randomUUID();
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
  let runId: string | undefined;

  try {
    const initial = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/user-messages`,
      payload: {
        turnId: initialTurnId,
        messageId: initialMessageId,
        content: initialContent,
      },
    });
    assert.equal(initial.statusCode, 202);
    const pending = initial.json() as { proposalId: string; intentVersionId: string };

    const persistedMessage = await pool.query<{ origin: string; content: string; message_horizon: string }>(
      `SELECT origin,content,message_horizon::text
       FROM intent_user_messages WHERE message_id=$1`,
      [initialMessageId],
    );
    assert.equal(persistedMessage.rows[0]?.origin, "USER");
    assert.equal(persistedMessage.rows[0]?.content, initialContent);
    assert.equal(persistedMessage.rows[0]?.message_horizon, "1");
    assert.equal((await intentStore.getScope(scopeId))?.currentIntentVersionId, pending.intentVersionId);

    const confirmation = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clarifications/${pending.proposalId}/confirm`,
      payload: {
        turnId: confirmationTurnId,
        messageId: confirmationMessageId,
        content: "Hard requirement.",
      },
    });
    assert.equal(confirmation.statusCode, 202);
    runId = confirmation.json().runId as string;
    const intentVersionId = confirmation.json().intentVersionId as string;

    const persisted = await pool.query<{
      intent_scope_id: string;
      intent_version_id: string;
      dispatches: string;
      idempotency: string;
      user_messages: string;
    }>(
      `SELECT b.intent_scope_id,b.intent_version_id,
         (SELECT count(*)::text FROM dispatch_outbox d WHERE d.run_id=b.run_id) AS dispatches,
         (SELECT count(*)::text FROM api_idempotency_keys i WHERE i.run_id=b.run_id) AS idempotency,
         (SELECT count(*)::text FROM intent_user_messages m WHERE m.intent_scope_id=b.intent_scope_id) AS user_messages
       FROM run_intent_bindings b WHERE b.run_id=$1`,
      [runId],
    );
    assert.equal(persisted.rows[0]?.intent_scope_id, scopeId);
    assert.equal(persisted.rows[0]?.intent_version_id, intentVersionId);
    assert.equal(persisted.rows[0]?.dispatches, "1");
    assert.equal(persisted.rows[0]?.idempotency, "1");
    assert.equal(persisted.rows[0]?.user_messages, "2");

    const exactVersion = await intentStore.getVersion(intentVersionId);
    assert.equal(exactVersion?.state.requirements["batteryHours.min"]?.provenance.kind, "USER_CONFIRMED");

    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${scopeId}/clarifications/${pending.proposalId}/confirm`,
      payload: {
        turnId: confirmationTurnId,
        messageId: confirmationMessageId,
        content: "Hard requirement.",
      },
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
