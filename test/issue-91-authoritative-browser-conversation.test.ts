import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

test("canonical browser exposes one Solandra surface with neutral Owner authentication", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  const conversationIndex = html.indexOf('body.status === "CONVERSATION_COMPLETED"');
  const guardIndex = html.indexOf("if (!body.runId) throw new Error(");
  assert.ok(conversationIndex >= 0, "ordinary conversation handling must be present");
  assert.ok(guardIndex >= 0, "required-Run guard must remain present for governed work");
  assert.ok(conversationIndex < guardIndex, "ordinary conversation must be handled before required-Run logic");
  assert.match(html, /\/api\/v1\/auth\/session/u);
  assert.doesNotMatch(html, /COGNITIVE_ASSISTANCE|Cognitive assistance|Model assistance/u);
  assert.doesNotMatch(html, /\/api\/v1\/capabilities\/(?:user-model|model-assistance)/u);
});
