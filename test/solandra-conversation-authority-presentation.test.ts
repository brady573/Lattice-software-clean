import assert from "node:assert/strict";
import test from "node:test";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

type ConversationBody = {
  status: "CONVERSATION_COMPLETED";
  presentation: { assistantMessage: string };
  conversationResponse?: { factualAuthority?: boolean };
};

type TurnBody = {
  status: string;
  presentation?: { assistantMessage?: string };
  conversationResponse?: { factualAuthority?: boolean };
  proposalId?: string;
  question?: string;
  confirmationExample?: string;
  knowledge?: unknown;
  runId?: string;
};

type Outcome = {
  kind: string;
  resource?: {
    title: string;
    body: string;
  };
  knowledge?: unknown;
  explanation?: string;
};

type RenderState = {
  visibleTurns: string[];
  authorityContextHidden: boolean;
};

type TurnRecord = {
  conversationId: string;
  message: string;
};

type RenderOptions = {
  recovered?: boolean;
  preparedBody?: string;
};

function renderedTurnResponseHandler(): (
  body: TurnBody,
  record: TurnRecord,
  setOrdinaryConversationContext: (visible: boolean) => void,
  setClarification: (value: unknown) => void,
  appendSolandraTurn: (text: string) => void,
  renderOutcome: (outcome: unknown, presentation: unknown) => void,
  setActiveWork: (work: unknown, cancellable: boolean) => void,
  pollOutcome: (work: unknown) => Promise<void>,
) => Promise<void> {
  const html = renderSolandraAuthoritativeConversationPage();
  const match = /const handleTurnResponse = async \(body, record\) => \{([\s\S]*?)\n      \};\n\n      const postTurnRecord/u.exec(html);
  assert.ok(match?.[1], "Canonical rendered page must include the structural turn-response dispatcher");
  return new Function(
    "body",
    "record",
    "setOrdinaryConversationContext",
    "setClarification",
    "appendSolandraTurn",
    "renderOutcome",
    "setActiveWork",
    "pollOutcome",
    `return (async () => {${match[1]}\n      })();`,
  ) as (
    body: TurnBody,
    record: TurnRecord,
    setOrdinaryConversationContext: (visible: boolean) => void,
    setClarification: (value: unknown) => void,
    appendSolandraTurn: (text: string) => void,
    renderOutcome: (outcome: unknown, presentation: unknown) => void,
    setActiveWork: (work: unknown, cancellable: boolean) => void,
    pollOutcome: (work: unknown) => Promise<void>,
  ) => Promise<void>;
}

function renderedOutcomeHandler(): (
  outcome: Outcome,
  presentation: { assistantMessage?: string },
  options: RenderOptions,
  setOrdinaryConversationContext: (visible: boolean) => void,
  composer: { innerHTML: string },
  renderKnowledge: (outcome: unknown) => string,
  appendSolandraTurn: (text: string) => void,
  renderPreparedResource: (resource: unknown, knowledge: unknown, body: string) => void,
) => void {
  const html = renderSolandraAuthoritativeConversationPage();
  const match = /const renderOutcome = \(outcome, presentation, options = \{\}\) => \{([\s\S]*?)\n      \};\n\n      const productFailureMessage/u.exec(html);
  assert.ok(match?.[1], "Canonical rendered page must include the governed outcome dispatcher");
  return new Function(
    "outcome",
    "presentation",
    "options",
    "setOrdinaryConversationContext",
    "composer",
    "renderKnowledge",
    "appendSolandraTurn",
    "renderPreparedResource",
    `let composerHasProductContent = false;${match[1]}`,
  ) as (
    outcome: Outcome,
    presentation: { assistantMessage?: string },
    options: RenderOptions,
    setOrdinaryConversationContext: (visible: boolean) => void,
    composer: { innerHTML: string },
    renderKnowledge: (outcome: unknown) => string,
    appendSolandraTurn: (text: string) => void,
    renderPreparedResource: (resource: unknown, knowledge: unknown, body: string) => void,
  ) => void;
}

function setConversationContext(state: RenderState, visible: boolean): void {
  state.authorityContextHidden = !visible;
}

async function presentTurn(body: TurnBody, state?: RenderState): Promise<RenderState> {
  const current = state ?? { visibleTurns: [], authorityContextHidden: true };
  const handler = renderedTurnResponseHandler();
  await handler(
    body,
    { conversationId: "conversation-1", message: "test message" },
    (visible) => setConversationContext(current, visible),
    () => {},
    (text) => current.visibleTurns.push(text),
    () => {},
    () => {},
    async () => {},
  );
  return current;
}

function presentOutcome(
  outcome: Outcome,
  presentation: { assistantMessage?: string },
  state: RenderState,
): { composerHtml: string; preparedBody: string | null } {
  const composer = { innerHTML: "" };
  let preparedBody: string | null = null;
  const handler = renderedOutcomeHandler();
  handler(
    outcome,
    presentation,
    {},
    (visible) => setConversationContext(state, visible),
    composer,
    () => "<section>Governed Knowledge</section>",
    (text) => state.visibleTurns.push(text),
    (_resource, _knowledge, body) => {
      preparedBody = body;
      composer.innerHTML = "<section>Prepared material</section>";
    },
  );
  return { composerHtml: composer.innerHTML, preparedBody };
}

async function presentOrdinaryConversation(
  assistantMessage: string,
  state?: RenderState,
): Promise<RenderState> {
  return await presentTurn({
    status: "CONVERSATION_COMPLETED",
    presentation: { assistantMessage },
    conversationResponse: { factualAuthority: false },
  }, state);
}

test("ordinary factual guidance remains unchanged while general-conversation context becomes visible", async () => {
  const state = await presentOrdinaryConversation(
    "A practical first step is to compare the two options under the conditions you actually expect.",
  );

  assert.deepEqual(state.visibleTurns, [
    "A practical first step is to compare the two options under the conditions you actually expect.",
  ]);
  assert.equal(state.authorityContextHidden, false);
  assert.doesNotMatch(state.visibleTurns[0] ?? "", /Not verified against sources|NON_AUTHORITATIVE_CONVERSATION|factualAuthority/u);

  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /id="conversationAuthorityContext"[^>]*>General conversation<\/div>/u);
});

test("non-factual brainstorming stays natural and does not receive a source-verification warning", async () => {
  const state = await presentOrdinaryConversation(
    "Here are three playful names: Lantern Fox, Pebble & Pine, and Juniper Kite.",
  );

  assert.deepEqual(state.visibleTurns, [
    "Here are three playful names: Lantern Fox, Pebble & Pine, and Juniper Kite.",
  ]);
  assert.equal(state.authorityContextHidden, false);
  assert.doesNotMatch(state.visibleTurns[0] ?? "", /source|verified|warning/iu);
});

test("governed Knowledge keeps its separate findings, uncertainty, and source presentation path", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  const knowledgeStart = html.indexOf('const renderKnowledge = (knowledge) => {');
  const lifecycleStart = html.indexOf('const setOrdinaryConversationContext = (visible) => {');
  assert.ok(knowledgeStart >= 0 && lifecycleStart > knowledgeStart, "Governed Knowledge renderer must remain present");
  const knowledgeRenderer = html.slice(knowledgeStart, lifecycleStart);
  assert.match(knowledgeRenderer, /What remains uncertain/u);
  assert.match(knowledgeRenderer, /Sources/u);
  assert.doesNotMatch(knowledgeRenderer, /conversationAuthorityContext|General conversation/u);
});

test("conversation authority context follows conversation to governed Knowledge and back", async () => {
  const state = await presentOrdinaryConversation("Start with a general explanation.");
  assert.equal(state.authorityContextHidden, false);

  const rendered = presentOutcome(
    { kind: "KNOWLEDGE" },
    { assistantMessage: "I established the requested Knowledge and preserved its evidence below." },
    state,
  );
  assert.equal(rendered.composerHtml, "<section>Governed Knowledge</section>");
  assert.equal(state.authorityContextHidden, true);

  await presentOrdinaryConversation("Now let's brainstorm what to do with those findings.", state);
  assert.equal(state.authorityContextHidden, false);
  assert.deepEqual(state.visibleTurns, [
    "Start with a general explanation.",
    "I established the requested Knowledge and preserved its evidence below.",
    "Now let's brainstorm what to do with those findings.",
  ]);
});

test("direct Recommendation-family presentation hides general conversation and later conversation reveals it", async () => {
  const state = await presentOrdinaryConversation("Give me a general framing first.");
  assert.equal(state.authorityContextHidden, false);

  await presentTurn({
    status: "RECOMMENDATION_REFERENCE_RESOLVED",
    presentation: { assistantMessage: "I restored the referenced recommendation without changing its authority." },
  }, state);
  assert.equal(state.authorityContextHidden, true);
  assert.equal(state.visibleTurns.at(-1), "I restored the referenced recommendation without changing its authority.");

  await presentOrdinaryConversation("Now explain the trade-off conversationally.", state);
  assert.equal(state.authorityContextHidden, false);
  assert.equal(state.visibleTurns.at(-1), "Now explain the trade-off conversationally.");
});

test("ACTION_PREPARATION presentation hides general conversation and later conversation reveals it", async () => {
  const state = await presentOrdinaryConversation("Help me think through the wording first.");
  assert.equal(state.authorityContextHidden, false);

  const rendered = presentOutcome({
    kind: "ACTION_PREPARATION",
    resource: {
      title: "Prepared note",
      body: "Editable prepared material",
    },
  }, {}, state);
  assert.equal(rendered.preparedBody, "Editable prepared material");
  assert.equal(rendered.composerHtml, "<section>Prepared material</section>");
  assert.equal(state.authorityContextHidden, true);
  assert.equal(state.visibleTurns.at(-1), "I prepared editable material in the Composer. Nothing has been sent or executed.");

  await presentOrdinaryConversation("Let's discuss whether that wording sounds right.", state);
  assert.equal(state.authorityContextHidden, false);
  assert.equal(state.visibleTurns.at(-1), "Let's discuss whether that wording sounds right.");
});

test("two-turn ordinary conversation remains fluid without repeated trust-warning text", async () => {
  const state = await presentOrdinaryConversation("Start with the smaller change and observe the result.");
  await presentOrdinaryConversation(
    "Given that result, the second option may be worth comparing next.",
    state,
  );

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
  const state = await presentTurn(body);

  assert.equal(state.authorityContextHidden, true);
  assert.deepEqual(body, before);

  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /setOrdinaryConversationContext\(body\.conversationResponse\?\.factualAuthority === false\)/u);
  assert.match(html, /const handleTurnResponse = async \(body, record\) => \{\n        setOrdinaryConversationContext\(false\);/u);
  assert.match(html, /const renderOutcome = \(outcome, presentation, options = \{\}\) => \{\n        setOrdinaryConversationContext\(false\);/u);
  assert.doesNotMatch(html, /General guidance · Not verified against sources/u);
});
