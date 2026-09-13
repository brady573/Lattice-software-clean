import assert from "node:assert/strict";
import test from "node:test";
import { PostgresConversationResponseStore } from "../src/conversation/conversation-response-store.js";
import { PostgresConversationStore } from "../src/conversation/conversation-store.js";

const databaseUrl = process.env.DATABASE_URL;

test(
  "Issue #91 PostgreSQL conversation response survives reconnect without acquiring authority",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    await PostgresConversationStore.migrate(databaseUrl);
    await PostgresConversationResponseStore.migrate(databaseUrl);

    let conversations = await PostgresConversationStore.connect(databaseUrl);
    let responses = await PostgresConversationResponseStore.connect(databaseUrl);
    const conversationId = "issue-91-reconnect-conversation";
    const sourceMessageId = "issue-91-reconnect-user-message";
    try {
      await conversations.create(conversationId, "issue-91-reconnect-user");
      await responses.putResponse({
        responseId: "issue-91-reconnect-response",
        conversationId,
        sourceMessageId,
        content: "Persisted conversational prose.",
        origin: "SOLANDRA",
        authority: "NON_AUTHORITATIVE_CONVERSATION",
        factualAuthority: false,
        createdAt: "2026-09-13T04:00:00.000Z",
      });
    } finally {
      await responses.close();
      await conversations.close();
    }

    conversations = await PostgresConversationStore.connect(databaseUrl);
    responses = await PostgresConversationResponseStore.connect(databaseUrl);
    try {
      const persisted = await responses.getResponse("issue-91-reconnect-response");
      assert.ok(persisted);
      assert.equal(persisted.conversationId, conversationId);
      assert.equal(persisted.sourceMessageId, sourceMessageId);
      assert.equal(persisted.origin, "SOLANDRA");
      assert.equal(persisted.authority, "NON_AUTHORITATIVE_CONVERSATION");
      assert.equal(persisted.factualAuthority, false);
      assert.equal("knowledgeId" in persisted, false);
      assert.equal("intentVersionId" in persisted, false);
      assert.equal("authorizationId" in persisted, false);
    } finally {
      await conversations.deleteOwned(conversationId, "issue-91-reconnect-user");
      await responses.close();
      await conversations.close();
    }
  },
);
