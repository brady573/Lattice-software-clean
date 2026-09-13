import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

test("Issue #91 authoritative browser handles ordinary conversation before required Run logic", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  const conversationIndex = html.indexOf('body.status === "CONVERSATION_COMPLETED"');
  const legacyIndex = html.indexOf('body.status === "COGNITIVE_ASSISTANCE_COMPLETED"');
  const guardIndex = html.indexOf("if (!body.runId) throw new Error(");
  assert.ok(conversationIndex >= 0, "ordinary conversation handling must be present");
  assert.ok(legacyIndex >= 0, "legacy cognitive-assistance compatibility remains available");
  assert.ok(guardIndex >= 0, "required-Run guard must remain present for governed work");
  assert.ok(conversationIndex < legacyIndex, "ordinary conversation is the primary direct-response path");
  assert.ok(legacyIndex < guardIndex, "direct responses must be handled before required-Run logic");
});
