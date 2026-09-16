import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

type ConversationBody = {
  status: "CONVERSATION_COMPLETED";
  presentation: { assistantMessage: string };
  conversationResponse?: { factualAuthority?: boolean };
};

type RenderState = {
  visibleTurns: string[];
  authorityContextHidden: boolean;
};

function renderedConversationHandler(): (
  body: ConversationBody,
  appendSolandraTurn: (text: string) => void,
  document: { getElementById(id: string): { hidden: boolean } | null },
) => Promise<void> {
  const html = renderSolandraAuthoritativeConversationPage();
  const match = /if \(body\.status === "CONVERSATION_COMPLETED"\) \{([\s\S]*?)\n        \}\n        if \(body\.status === "COGNITIVE_ASSISTANCE_COMPLETED"\)/u.exec(html);
  assert.ok(match?.[1], "Canonical rendered page must include direct conversation handling");
  return new Function(
    "body",
    "appendSolandraTurn",
    "document",
    `return (async () => { if (body.status === "CONVERSATION_COMPLETED") {${match[1]}\n        } })();`,
  ) as (
    body: ConversationBody,
    appendSolandraTurn: (text: string) => void,
    document: { getElementById(id: string): { hidden: boolean } | null },
  ) => Promise<void>;
}

function renderedKnowledgeHandler(): (
  outcome: { kind: "KNOWLEDGE" },
  presentation: { assistantMessage?: string },
  options: { recovered?: boolean },
  composer: { innerHTML: string },
  renderKnowledge: (outcome: { kind: "KNOWLEDGE" }) => string,
  appendSolandraTurn: (text: string) => void,
  document: { getElementById(id: string): { hidden: boolean } | null },
) => void {
  const html = renderSolandraAuthoritativeConversationPage();
  const match = /if \(outcome\.kind === "KNOWLEDGE"\) \{([\s\S]*?)\n        \}\n        if \(outcome\.kind === "ACTION_PREPARATION"\)/u.exec(html);
  assert.ok(match?.[1], "Canonical rendered page must include governed Knowledge handling");
  return new Function(
    "outcome",
    "presentation",
    "options",
    "composer",
    "renderKnowledge",
    "appendSolandraTurn",
    "document",
    `if (outcome.kind === "KNOWLEDGE") {${match[1]}\n        }`,
  ) as (
    outcome: { kind: "KNOWLEDGE" },
    presentation: { assistantMessage?: string },
    options: { recovered?: boolean },
    composer: { innerHTML: string },
    renderKnowledge: (outcome: { kind: "KNOWLEDGE" }) => string,
    appendSolandraTurn: (text: string) => void,
    document: { getElementById(id: string): { hidden: boolean } | null },
  ) => void;
}

async function renderConversationTurn(body: ConversationBody, state?: RenderState): Promise<RenderState> {
  const current = state ?? { visibleTurns: [], authorityContextHidden: true };
  const authorityContext = { hidden: current.authorityContextHidden };
  const document = {
    getElementById(id: string) {
      return id === "conversationAuthorityContext" ? authorityContext : null;
    },
  };
  const handler = renderedConversationHandler();
  await handler(body, (text) => current.visibleTurns.push(text), document);
  current.authorityContextHidden = authorityContext.hidden;
  return current;
}

function renderKnowledgeOutcome(state: RenderState): RenderState {
  const authorityContext = { hidden: state.authorityContextHidden };
  const document = {
    getElementById(id: string) {
      return id === "conversationAuthorityContext" ? authorityContext : null;
    },
  };
  const composer = { innerHTML: "" };
  const handler = renderedKnowledgeHandler();
  handler(
    { kind: "KNOWLEDGE" },
    { assistantMessage: "I established the requested Knowledge and preserved its evidence below." },
    {},
    composer,
    () => "<section>Governed Knowledge</section>",
    () => {},
    document,
  );
  assert.equal(composer.innerHTML, "<section>Governed Knowledge</section>");
  state.authorityContextHidden = authorityContext.hidden;
  return state;
}

test("ordinary factual guidance remains unchanged while general-conversation context becomes visible", async () => {
  const state = await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "A practical first step is to compare the two options under the conditions you actually expect." },
    conversationResponse: { factualAuthority: false },
  });

  assert.deepEqual(state.visibleTurns, [
    "A practical first step is to compare the two options under the conditions you actually expect.",
  ]);
  assert.equal(state.authorityContextHidden, false);
  assert.doesNotMatch(state.visibleTurns[0] ?? "", /Not verified against sources|NON_AUTHORITATIVE_CONVERSATION|factualAuthority/u);

  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /id="conversationAuthorityContext"[^>]*>General conversation<\/div>/u);
});

test("non-factual brainstorming stays natural and does not receive a source-verification warning", async () => {
  const state = await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Here are three playful names: Lantern Fox, Pebble & Pine, and Juniper Kite." },
    conversationResponse: { factualAuthority: false },
  });

  assert.deepEqual(state.visibleTurns, [
    "Here are three playful names: Lantern Fox, Pebble & Pine, and Juniper Kite.",
  ]);
  assert.equal(state.authorityContextHidden, false);
  assert.doesNotMatch(state.visibleTurns[0] ?? "", /source|verified|warning/iu);
});

test("governed Knowledge keeps its separate findings, uncertainty, and source presentation path", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  const knowledgeStart = html.indexOf('const renderKnowledge = (knowledge) => {');
  const outcomeStart = html.indexOf('const renderOutcome = (outcome, presentation, options = {}) => {');
  assert.ok(knowledgeStart >= 0 && outcomeStart > knowledgeStart, "Governed Knowledge renderer must remain present");
  const knowledgeRenderer = html.slice(knowledgeStart, outcomeStart);
  assert.match(knowledgeRenderer, /What remains uncertain/u);
  assert.match(knowledgeRenderer, /Sources/u);
  assert.doesNotMatch(knowledgeRenderer, /conversationAuthorityContext|General conversation/u);
});

test("conversation authority context follows conversation to governed Knowledge and back", async () => {
  const state = await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Start with a general explanation." },
    conversationResponse: { factualAuthority: false },
  });
  assert.equal(state.authorityContextHidden, false);

  renderKnowledgeOutcome(state);
  assert.equal(state.authorityContextHidden, true);

  await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Now let's brainstorm what to do with those findings." },
    conversationResponse: { factualAuthority: false },
  }, state);
  assert.equal(state.authorityContextHidden, false);
  assert.deepEqual(state.visibleTurns, [
    "Start with a general explanation.",
    "Now let's brainstorm what to do with those findings.",
  ]);
});

test("two-turn ordinary conversation remains fluid without repeated trust-warning text", async () => {
  const state = await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Start with the smaller change and observe the result." },
    conversationResponse: { factualAuthority: false },
  });
  await renderConversationTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "Given that result, the second option may be worth comparing next." },
    conversationResponse: { factualAuthority: false },
  }, state);

  assert.deepEqual(state.visibleTurns, [
    "Start with the smaller change and observe the result.",
    "Given that result, the second option may be worth comparing next.",
  ]);
  assert.equal(state.authorityContextHidden, false);
  assert.ok(state.visibleTurns.every((turn) => !/verified against sources|general guidance/iu.test(turn)));
});

test("structural factual-authority metadata controls the context without prose inference or mutation", async () => {
  const body: ConversationBody = {
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage: "This sentence could sound factual, but presentation does not classify its words." },
  };
  const before = structuredClone(body);
  const state = await renderConversationTurn(body);

  assert.equal(state.authorityContextHidden, true);
  assert.deepEqual(body, before);

  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /body\.conversationResponse\?\.factualAuthority === false/u);
  assert.doesNotMatch(html, /General guidance · Not verified against sources/u);
});
