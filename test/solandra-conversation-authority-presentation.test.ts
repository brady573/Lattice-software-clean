import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

type ConversationBody = {
  status: "CONVERSATION_COMPLETED";
  presentation: { assistantMessage: string };
  conversationResponse?: { factualAuthority?: boolean };
};

function renderedConversationHandler(): (body: ConversationBody, appendSolandraTurn: (text: string) => void) => Promise<void> {
  const html = renderSolandraAuthoritativeConversationPage();
  const match = /if \(body\.status === "CONVERSATION_COMPLETED"\) \{([\s\S]*?)\n        \}\n        if \(body\.status === "COGNITIVE_ASSISTANCE_COMPLETED"\)/u.exec(html);
  assert.ok(match?.[1], "Canonical rendered page must include direct conversation handling");
  return new Function(
    "body",
    "appendSolandraTurn",
    `return (async () => { if (body.status === "CONVERSATION_COMPLETED") {${match[1]}\n        } })();`,
  ) as (body: ConversationBody, appendSolandraTurn: (text: string) => void) => Promise<void>;
}

async function renderConversationTurn(body: ConversationBody, visibleTurns: string[] = []): Promise<string[]> {
  const handler = renderedConversationHandler();
  await handler(body, (text) => visibleTurns.push(text));
  return visibleTurns;
}

test("rendered non-authoritative conversation keeps the answer visible with a plain trust cue", async () => {
  const turns = await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "A practical first step is to compare the two options under the conditions you actually expect." },
    conversationResponse: { factualAuthority: false },
  });

  assert.deepEqual(turns, [
    "A practical first step is to compare the two options under the conditions you actually expect.\n\nGeneral guidance · Not verified against sources",
  ]);
  assert.doesNotMatch(turns[0] ?? "", /NON_AUTHORITATIVE_CONVERSATION|factualAuthority|KnowledgeOutcome|V36|authority enum|governance state/u);
});

test("rendered conversation does not invent an unverified cue without structural factual-authority metadata", async () => {
  const turns = await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Conversation stays available." },
  });

  assert.deepEqual(turns, ["Conversation stays available."]);
});

test("two ordinary rendered turns remain fluid while preserving the same trust distinction", async () => {
  const visibleTurns: string[] = [];
  await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Start with the smaller change and observe the result." },
    conversationResponse: { factualAuthority: false },
  }, visibleTurns);
  await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Given that result, the second option may be worth comparing next." },
    conversationResponse: { factualAuthority: false },
  }, visibleTurns);

  assert.equal(visibleTurns.length, 2);
  assert.match(visibleTurns[0] ?? "", /^Start with the smaller change/u);
  assert.match(visibleTurns[1] ?? "", /^Given that result/u);
  assert.ok(visibleTurns.every((turn) => turn.endsWith("General guidance · Not verified against sources")));
});

test("non-authoritative option comparison remains decision support rather than established Knowledge", async () => {
  const turns = await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Option A is simpler to try; Option B may offer more control if the extra setup is worthwhile to you." },
    conversationResponse: { factualAuthority: false },
  });

  const visible = turns[0] ?? "";
  assert.match(visible, /Option A is simpler to try; Option B may offer more control/u);
  assert.match(visible, /General guidance · Not verified against sources$/u);
  assert.doesNotMatch(visible, /authorized|accepted choice|established Knowledge/iu);
});

test("governed Knowledge keeps its separate findings, uncertainty, and source presentation path", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  const knowledgeStart = html.indexOf('const renderKnowledge = (knowledge) => {');
  const outcomeStart = html.indexOf('const renderOutcome = (outcome, presentation, options = {}) => {');
  assert.ok(knowledgeStart >= 0 && outcomeStart > knowledgeStart, "Governed Knowledge renderer must remain present");
  const knowledgeRenderer = html.slice(knowledgeStart, outcomeStart);
  assert.match(knowledgeRenderer, /What remains uncertain/u);
  assert.match(knowledgeRenderer, /Sources/u);
  assert.doesNotMatch(knowledgeRenderer, /General guidance · Not verified against sources/u);
});
