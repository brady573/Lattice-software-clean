import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { createRuntimeApp } from "../src/runtime-app.js";
import type { RuntimeConfig } from "../src/runtime-config.js";

const databaseUrl = process.env.DATABASE_URL;
const clearContent = "I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.";

function config(database: string | undefined, autoMigrate: boolean): RuntimeConfig {
  return {
    port: 3000,
    host: "127.0.0.1",
    databaseUrl: database,
    deploymentMode: "development",
    truthMode: "v36-offline",
    autoMigrate,
    modelSimulatorBaseUrl: undefined,
    modelSimulatorModel: "offline-prototype",
    androidModelRelayToken: undefined,
    androidModelRelayModel: "android-local-prototype",
    androidModelRelayTimeoutMs: 45_000,
  };
}

async function createBoundRun(app: Awaited<ReturnType<typeof createRuntimeApp>>, suffix: string) {
  const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(created.statusCode, 201);
  const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
  const accepted = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: `turn-${suffix}`, message: clearContent },
  });
  assert.equal(accepted.statusCode, 202);
  return { conversationId, accepted: accepted.json<{ runId: string; intentScopeId: string; intentVersionId: string }>() };
}

test("Conversation continuity rediscovers USER provenance and exact-bound Run from Conversation id", async () => {
  const app = await createRuntimeApp(config(undefined, false), { memoryDispatchDelayMs: 1_000 });
  try {
    const { conversationId, accepted } = await createBoundRun(app, "m7-f-memory");
    const response = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.conversation.id, conversationId);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].content, clearContent);
    assert.equal(body.runs.length, 1);
    assert.equal(body.runs[0].runId, accepted.runId);
    assert.equal(body.runs[0].exactBinding.intentScopeId, accepted.intentScopeId);
    assert.equal(body.runs[0].exactBinding.intentVersionId, accepted.intentVersionId);
    assert.equal(body.runs[0].links.result, `/api/v1/runs/${accepted.runId}/result`);
  } finally {
    await app.close();
  }
});

test("PostgreSQL Conversation continuity survives runtime restart", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  let conversationId = "";
  let runId = "";
  let intentScopeId = "";
  let intentVersionId = "";

  const first = await createRuntimeApp(config(databaseUrl, true));
  try {
    const created = await createBoundRun(first, `m7-f-pg-${Date.now()}`);
    conversationId = created.conversationId;
    runId = created.accepted.runId;
    intentScopeId = created.accepted.intentScopeId;
    intentVersionId = created.accepted.intentVersionId;
  } finally {
    await first.close();
  }

  const reopened = await createRuntimeApp(config(databaseUrl, false));
  try {
    const response = await reopened.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.conversation.id, conversationId);
    assert.equal(body.messages.length, 1);
    assert.equal(body.runs.length, 1);
    assert.equal(body.runs[0].runId, runId);
    assert.equal(body.runs[0].exactBinding.intentScopeId, intentScopeId);
    assert.equal(body.runs[0].exactBinding.intentVersionId, intentVersionId);
  } finally {
    await reopened.close();
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("DELETE FROM decision_plans WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_intent_bindings WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM run_events WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM dispatch_outbox WHERE run_id=$1", [runId]);
      await pool.query("DELETE FROM runs WHERE id=$1", [runId]);
      await pool.query("DELETE FROM intent_user_messages WHERE conversation_id=$1", [conversationId]);
      await pool.query("DELETE FROM intent_scopes WHERE intent_scope_id=$1", [intentScopeId]);
      await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    } finally {
      await pool.end();
    }
  }
});
