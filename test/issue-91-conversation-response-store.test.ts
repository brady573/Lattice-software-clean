import assert from "node:assert/strict";
import test from "node:test";
import { MemoryConversationResponseStore } from "../src/conversation/conversation-response-store.js";

test("Issue #91 persisted Solandra conversation prose cannot acquire factual authority", async () => {
  const store = new MemoryConversationResponseStore();
  try {
    const persisted = await store.putResponse({
      responseId: "response-91",
      conversationId: "conversation-91",
      sourceMessageId: "message-91",
      content: "A model-generated sentence that sounds factual.",
      origin: "SOLANDRA",
      authority: "NON_AUTHORITATIVE_CONVERSATION",
      factualAuthority: false,
      createdAt: "2026-09-13T03:30:00.000Z",
    });
    assert.equal(persisted.origin, "SOLANDRA");
    assert.equal(persisted.authority, "NON_AUTHORITATIVE_CONVERSATION");
    assert.equal(persisted.factualAuthority, false);
    assert.equal((persisted as Record<string, unknown>).knowledgeId, undefined);
    assert.equal((persisted as Record<string, unknown>).intentVersionId, undefined);
    assert.equal((persisted as Record<string, unknown>).authorizationId, undefined);
  } finally {
    await store.close();
  }
});
