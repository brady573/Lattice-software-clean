import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import type { RuntimeConfig } from "../src/runtime-config.js";

const config: RuntimeConfig = {
  port: 3000,
  host: "127.0.0.1",
  databaseUrl: undefined,
  deploymentMode: "development",
  truthMode: "v36-offline",
  autoMigrate: false,
  modelSimulatorBaseUrl: undefined,
  modelSimulatorModel: "offline-prototype",
  androidModelRelayToken: undefined,
  androidModelRelayModel: "android-local-prototype",
  androidModelRelayTimeoutMs: 45_000,
};

const clearPayload = {
  turnId: "m7-d-turn-1",
  messageId: "m7-d-message-1",
  content: "I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.",
};

test("M7 authoritative USER writes require an existing durable Conversation", async () => {
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 0 });

  try {
    const absentConversationId = "conversation-m7-d-absent";
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${absentConversationId}/turns`,
      payload: { turnId: clearPayload.turnId, message: clearPayload.content },
    });
    assert.equal(rejected.statusCode, 404);
    assert.deepEqual(rejected.json(), { error: "CONVERSATION_NOT_FOUND" });

    const absentHistory = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${absentConversationId}/messages`,
    });
    assert.equal(absentHistory.statusCode, 404);
    assert.deepEqual(absentHistory.json(), { error: "CONVERSATION_NOT_FOUND" });

    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: clearPayload.turnId, message: clearPayload.content },
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(accepted.json().status, "RUN_ACCEPTED");

    const history = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/messages`,
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().messages.length, 1);
    assert.equal(history.json().messages[0].content, clearPayload.content);
    assert.equal(history.json().messages[0].conversationId, conversationId);
    assert.equal(history.json().messages[0].role, "USER");
  } finally {
    await app.close();
  }
});
