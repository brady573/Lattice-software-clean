import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

type StructuredConversationBody = {
  status: "CONVERSATION_COMPLETED";
  presentation: {
    assistantMessage: string;
    conversation: {
      opening: string;
      closing: string | null;
    };
    composer: { body: string } | null;
  };
  conversationResponse: { factualAuthority: false };
};

class QueueConversationProvider implements ModelProvider {
  readonly kind = "conversation-composer-queue";
  readonly requests: CanonicalModelRequest[] = [];

  constructor(private readonly outputs: readonly unknown[]) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    const index = this.requests.length;
    this.requests.push(request);
    const output = this.outputs[index];
    if (output === undefined) throw new Error("Unexpected extra cognition request.");
    return {
      response: {
        id: `conversation-composer-${index + 1}`,
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(output) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `conversation-composer-request-${index + 1}`,
      },
    };
  }
}

function memoryConfig() {
  return resolveRuntimeConfig({
    NODE_ENV: "test",
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "conversation-composer-user",
  });
}

function renderedConversationCompletionHandler(): (
  body: StructuredConversationBody,
  appendSolandraTurn: (text: string) => void,
  setOrdinaryConversationContext: (visible: boolean) => void,
  composer: { innerHTML: string },
  escapeHtml: (value: unknown) => string,
) => void {
  const html = renderSolandraAuthoritativeConversationPage();
  const match = /if \(body\.status === "CONVERSATION_COMPLETED"\) \{([\s\S]*?)\n        \}\n        if \(body\.status === "COGNITIVE_ASSISTANCE_COMPLETED"\)/u.exec(html);
  assert.ok(match?.[1], "Rendered Product surface must contain structural ordinary-conversation presentation.");
  return new Function(
    "body",
    "appendSolandraTurn",
    "setOrdinaryConversationContext",
    "composer",
    "escapeHtml",
    `let composerHasProductContent = false; if (body.status === "CONVERSATION_COMPLETED") {${match[1]}\n        }`,
  ) as (
    body: StructuredConversationBody,
    appendSolandraTurn: (text: string) => void,
    setOrdinaryConversationContext: (visible: boolean) => void,
    composer: { innerHTML: string },
    escapeHtml: (value: unknown) => string,
  ) => void;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

test("ordinary cognition carries structural Conversation and Composer roles through durable turn replay", async () => {
  const provider = new QueueConversationProvider([
    {
      mode: "CONVERSATION",
      presentation: {
        opening: "A brief frame for the work.",
        composerBody: ["Substantive body", "- first item", "- second item"],
        closing: "We can refine any part of that next.",
      },
    },
    {
      mode: "CONVERSATION",
      presentation: {
        opening: "A short conversational continuation.",
        composerBody: null,
        closing: null,
      },
    },
  ]);
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "conversation-composer-model");
  const app = await createRuntimeApp(memoryConfig(), { solandraCognition: cognition, memoryDispatchDelayMs: 1 });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201);
    const conversationId = created.json().conversation.id as string;

    const firstRequest = {
      method: "POST" as const,
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "structured-turn", message: "Produce an ordinary response with substantial usable work." },
    };
    const first = await app.inject(firstRequest);
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.status, "CONVERSATION_COMPLETED");
    assert.deepEqual(firstBody.presentation.conversation, {
      opening: "A brief frame for the work.",
      closing: "We can refine any part of that next.",
    });
    assert.deepEqual(firstBody.presentation.composer, {
      body: "Substantive body\n\n- first item\n\n- second item",
    });
    assert.equal(firstBody.presentation.assistantMessage, "A brief frame for the work.\n\nWe can refine any part of that next.");
    assert.equal(firstBody.conversationResponse.authority, "NON_AUTHORITATIVE_CONVERSATION");
    assert.equal(firstBody.conversationResponse.factualAuthority, false);

    const replay = await app.inject(firstRequest);
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json().presentation, firstBody.presentation);
    assert.equal(provider.requests.length, 1, "Durable replay must reuse the same structural presentation.");

    const second = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "short-turn", message: "Continue briefly." },
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json();
    assert.deepEqual(secondBody.presentation.conversation, {
      opening: "A short conversational continuation.",
      closing: null,
    });
    assert.equal(secondBody.presentation.composer, null);

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200);
    const solandraMessages = continuity.json().messages.filter((message: { role: string }) => message.role === "SOLANDRA");
    assert.equal(solandraMessages.length, 2);
    assert.match(solandraMessages[0].content, /Substantive body/u);
    assert.equal(solandraMessages[0].factualAuthority, false);
  } finally {
    await app.close();
  }
});

test("rendered ordinary composition keeps framing in Conversation, work in Composer, and the cue scoped to Conversation", () => {
  const handler = renderedConversationCompletionHandler();
  const turns: string[] = [];
  const composer = { innerHTML: "<p>prior composer state</p>" };
  let generalConversationVisible = false;

  handler({
    status: "CONVERSATION_COMPLETED",
    presentation: {
      assistantMessage: "Opening frame.\n\nClosing continuation.",
      conversation: {
        opening: "Opening frame.",
        closing: "Closing continuation.",
      },
      composer: { body: "Substantive body with <literal> text." },
    },
    conversationResponse: { factualAuthority: false },
  }, (text) => turns.push(text), (visible) => { generalConversationVisible = visible; }, composer, escapeHtml);

  assert.deepEqual(turns, ["Opening frame.", "Closing continuation."]);
  assert.equal(generalConversationVisible, true);
  assert.match(composer.innerHTML, /data-presentation-role="ordinary-generated-work"/u);
  assert.match(composer.innerHTML, /Substantive body with &lt;literal&gt; text\./u);
  assert.ok(turns.every((turn) => !turn.includes("Substantive body")), "Composer body must not be duplicated into Conversation.");

  const composerAfterSubstantiveTurn = composer.innerHTML;
  handler({
    status: "CONVERSATION_COMPLETED",
    presentation: {
      assistantMessage: "A brief follow-up.",
      conversation: {
        opening: "A brief follow-up.",
        closing: null,
      },
      composer: null,
    },
    conversationResponse: { factualAuthority: false },
  }, (text) => turns.push(text), (visible) => { generalConversationVisible = visible; }, composer, escapeHtml);

  assert.equal(turns.at(-1), "A brief follow-up.");
  assert.equal(composer.innerHTML, composerAfterSubstantiveTurn, "A short later turn must not collapse or blank independent Composer state.");
  assert.equal(generalConversationVisible, true);
});

test("ordinary Composer placement is structural and introduces no prose classifier", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /body\.presentation\?\.composer\?\.body/u);
  assert.match(html, /body\.presentation\?\.conversation/u);
  assert.doesNotMatch(html, /Cat6|patch panel|step-by-step|markdown|first sentence|last sentence/iu);
  assert.match(html, /data-presentation-role="ordinary-generated-work"/u);
});
