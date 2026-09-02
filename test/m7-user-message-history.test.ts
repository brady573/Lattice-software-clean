import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { registerDurableUserMessageHistory } from "../src/conversation/user-message-history.js";
import {
  MemoryIntentUserMessageStore,
  PostgresIntentUserMessageStore,
} from "../src/intent/source-message-store.js";
import { MemoryRunStore } from "../src/run-store.js";

const databaseUrl = process.env.DATABASE_URL;

function messageInput(
  conversationId: string,
  scopeId: string,
  horizon: number,
  content: string,
  identity = `${conversationId}-${horizon}`,
) {
  return {
    conversationId,
    intentScopeId: scopeId,
    logicalUserTurnId: `turn-${identity}`,
    messageId: `message-${identity}`,
    messageHorizon: horizon,
    content,
  };
}

test("M7 USER message history exposes persisted M5 provenance without creating new message authority", async () => {
  const conversationId = "conversation-m7-memory";
  const store = new MemoryIntentUserMessageStore();
  await store.append(messageInput(conversationId, "scope-a", 1, "First durable USER message.", "1"));
  await store.append(messageInput(conversationId, "scope-b", 2, "Second durable USER message.", "2"));
  await store.append(messageInput("other-conversation", "scope-c", 1, "Unrelated message.", "other-1"));

  const app = buildApp({ runStore: new MemoryRunStore() });
  registerDurableUserMessageHistory(app, { userMessageStore: store });

  try {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/messages`,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().messages.map((message: { id: string; role: string; content: string }) => ({
      id: message.id,
      role: message.role,
      content: message.content,
    })), [
      { id: "message-1", role: "USER", content: "First durable USER message." },
      { id: "message-2", role: "USER", content: "Second durable USER message." },
    ]);

    const empty = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/unknown/messages",
    });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), { messages: [] });

    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/conversations/%20/messages",
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "INVALID_CONVERSATION_ID");
  } finally {
    await app.close();
    await store.close();
  }
});

test("M7 PostgreSQL USER message history survives store restart", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  await PostgresIntentUserMessageStore.migrate(databaseUrl);

  const conversationId = `conversation-m7-${randomUUID()}`;
  const firstScopeId = `scope-m7-${randomUUID()}`;
  const secondScopeId = `scope-m7-${randomUUID()}`;
  const firstMessageId = randomUUID();
  const secondMessageId = randomUUID();
  let store = await PostgresIntentUserMessageStore.connect(databaseUrl, { migrate: false });
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await store.append({
      conversationId,
      intentScopeId: firstScopeId,
      logicalUserTurnId: randomUUID(),
      messageId: firstMessageId,
      messageHorizon: 1,
      content: "Persistent USER message one.",
    });
    await store.append({
      conversationId,
      intentScopeId: secondScopeId,
      logicalUserTurnId: randomUUID(),
      messageId: secondMessageId,
      messageHorizon: 2,
      content: "Persistent USER message two.",
    });

    await store.close();
    store = await PostgresIntentUserMessageStore.connect(databaseUrl, { migrate: false });

    const app = buildApp({ runStore: new MemoryRunStore() });
    registerDurableUserMessageHistory(app, { userMessageStore: store });
    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/conversations/${conversationId}/messages`,
      });
      assert.equal(response.statusCode, 200);
      const messages = response.json().messages as Array<{
        id: string;
        conversationId: string;
        role: string;
        content: string;
        createdAt: string;
      }>;
      assert.deepEqual(messages.map((message) => message.id), [firstMessageId, secondMessageId]);
      assert.ok(messages.every((message) => message.conversationId === conversationId));
      assert.ok(messages.every((message) => message.role === "USER"));
      assert.deepEqual(messages.map((message) => message.content), [
        "Persistent USER message one.",
        "Persistent USER message two.",
      ]);
      assert.ok(messages.every((message) => Number.isFinite(Date.parse(message.createdAt))));
    } finally {
      await app.close();
    }
  } finally {
    await store.close();
    await pool.query("DELETE FROM intent_user_messages WHERE conversation_id=$1", [conversationId]);
    await pool.end();
  }
});
