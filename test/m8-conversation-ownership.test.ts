import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { registerAuthenticatedSubjectBoundary } from "../src/auth/authenticated-subject.js";
import { registerConversationApi } from "../src/conversation/conversation-api.js";
import { MemoryConversationStore, PostgresConversationStore } from "../src/conversation/conversation-store.js";
import { MemoryRunStore } from "../src/run-store.js";

const databaseUrl = process.env.DATABASE_URL;

function testApp() {
  const conversationStore = new MemoryConversationStore();
  const app = buildApp({ runStore: new MemoryRunStore() });
  registerAuthenticatedSubjectBoundary(app, {
    resolveSubject: (request) => {
      const header = request.headers["x-test-subject"];
      return typeof header === "string" ? { subjectId: header } : undefined;
    },
  });
  registerConversationApi(app, { conversationStore });
  return app;
}

test("M8-B conversation creation binds immutable owner to authenticated subject", async () => {
  const app = testApp();
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations", headers: { "x-test-subject": "subject-a" } });
    assert.equal(created.statusCode, 201);
    const payload = created.json<{ conversation: { id: string; ownerSubjectId: string; createdAt: string } }>();
    assert.equal(payload.conversation.ownerSubjectId, "subject-a");

    const mutated = structuredClone(payload);
    mutated.conversation.ownerSubjectId = "subject-b";

    const read = await app.inject({ method: "GET", url: `/api/v1/conversations/${payload.conversation.id}`, headers: { "x-test-subject": "subject-a" } });
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), payload);
  } finally { await app.close(); }
});

test("M8-B cross-subject and missing conversation reads are non-disclosing", async () => {
  const app = testApp();
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations", headers: { "x-test-subject": "subject-a" } });
    const id = created.json<{ conversation: { id: string } }>().conversation.id;

    const crossUser = await app.inject({ method: "GET", url: `/api/v1/conversations/${id}`, headers: { "x-test-subject": "subject-b" } });
    const missing = await app.inject({ method: "GET", url: `/api/v1/conversations/${randomUUID()}`, headers: { "x-test-subject": "subject-b" } });

    assert.equal(crossUser.statusCode, 404);
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(crossUser.json(), { error: "CONVERSATION_NOT_FOUND" });
    assert.deepEqual(crossUser.json(), missing.json());
  } finally { await app.close(); }
});

test("M8-B PostgreSQL owner survives restart and rejects a different subject", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresConversationStore.migrate(databaseUrl);
  const id = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  let store = await PostgresConversationStore.connect(databaseUrl);
  try {
    const created = await store.create(id, "subject-a");
    await store.close();
    store = await PostgresConversationStore.connect(databaseUrl);

    assert.deepEqual(await store.getOwned(id, "subject-a"), created);
    assert.equal(await store.getOwned(id, "subject-b"), undefined);
  } finally {
    await store.close();
    await pool.query("DELETE FROM conversations WHERE id=$1", [id]);
    await pool.end();
  }
});

test("M8-B legacy unowned PostgreSQL conversations are not exposed as authenticated ownership", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresConversationStore.migrate(databaseUrl);
  const id = randomUUID();
  const pool = new Pool({ connectionString: databaseUrl });
  const store = await PostgresConversationStore.connect(databaseUrl);
  try {
    await pool.query("INSERT INTO conversations(id, owner_subject_id) VALUES ($1, NULL)", [id]);
    assert.equal(await store.getOwned(id, "subject-a"), undefined);
    assert.equal(await store.get(id), undefined);
  } finally {
    await store.close();
    await pool.query("DELETE FROM conversations WHERE id=$1", [id]);
    await pool.end();
  }
});
