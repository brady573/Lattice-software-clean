import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { registerAuthenticatedSubjectBoundary } from "../src/auth/authenticated-subject.js";
import { registerConversationApi } from "../src/conversation/conversation-api.js";
import {
  MemoryConversationStore,
  PostgresConversationStore,
} from "../src/conversation/conversation-store.js";
import { MemoryRunStore } from "../src/run-store.js";

const databaseUrl = process.env.DATABASE_URL;
const subjectId = "m7-durable-conversation-subject";

test("M7 conversation API creates and reads durable conversation identity", async () => {
  const conversationStore = new MemoryConversationStore();
  const app = buildApp({ runStore: new MemoryRunStore() });
  registerAuthenticatedSubjectBoundary(app, { resolveSubject: () => ({ subjectId }) });
  registerConversationApi(app, { conversationStore });

  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201);
    const payload = created.json<{ conversation: { id: string; ownerSubjectId: string; createdAt: string } }>();
    assert.match(payload.conversation.id, /^[0-9a-f-]{36}$/i);
    assert.equal(payload.conversation.ownerSubjectId, subjectId);
    assert.ok(Number.isFinite(Date.parse(payload.conversation.createdAt)));

    const read = await app.inject({ method: "GET", url: `/api/v1/conversations/${payload.conversation.id}` });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), payload);

    const missing = await app.inject({ method: "GET", url: `/api/v1/conversations/${randomUUID()}` });
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), { error: "CONVERSATION_NOT_FOUND" });

    const invalid = await app.inject({ method: "GET", url: "/api/v1/conversations/%20" });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(invalid.json(), { error: "INVALID_CONVERSATION_ID" });
  } finally {
    await app.close();
  }
});

test("M7 PostgreSQL conversation survives store restart with stable identity, owner, and timestamp", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresConversationStore.migrate(databaseUrl);

  const conversationId = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  let store = await PostgresConversationStore.connect(databaseUrl, { migrate: false });

  try {
    const created = await store.create(conversationId, subjectId);
    await store.close();

    store = await PostgresConversationStore.connect(databaseUrl, { migrate: false });
    const restored = await store.getOwned(conversationId, subjectId);
    assert.deepEqual(restored, created);
  } finally {
    await store.close();
    await pool.query("DELETE FROM conversations WHERE id=$1", [conversationId]);
    await pool.end();
  }
});
