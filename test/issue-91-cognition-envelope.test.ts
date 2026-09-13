import assert from "node:assert/strict";
import test from "node:test";
import { ModelRuntime } from "../src/model/runtime.js";
import type { ModelProvider } from "../src/model/provider.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

class CapturingProvider implements ModelProvider {
  readonly kind = "issue-91-fixture";
  readonly requests: CanonicalModelRequest[] = [];

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    return {
      response: {
        id: "response-91",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify({ mode: "CONVERSATION", response: "That follows from the earlier analogy." }) }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
      },
    };
  }
}

test("Issue #91 canonical cognition may answer ordinary conversation without semantic taxonomy projection", async () => {
  const provider = new CapturingProvider();
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "issue-91-model");
  const result = await cognition.interpret({
    conversationId: "conversation-91",
    messageId: "message-91",
    message: "Why does that analogy work?",
    recentUserMessages: ["Compare a cache to a library desk.", "Why does that analogy work?"],
    recentConversation: [
      { role: "USER", content: "Compare a cache to a library desk." },
      { role: "SOLANDRA", content: "Think of the desk as fast temporary access to a few books." },
      { role: "USER", content: "Why does that analogy work?" },
    ],
    governedKnowledge: [],
  });

  assert.equal(result.mode, "CONVERSATION");
  if (result.mode !== "CONVERSATION") assert.fail("expected conversational cognition");
  assert.equal(result.response, "That follows from the earlier analogy.");
  assert.equal(provider.requests.length, 1);
  const prompt = provider.requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
  assert.match(prompt, /SOLANDRA: Think of the desk as fast temporary access/u);
  assert.match(prompt, /Use CONVERSATION for ordinary discussion/u);
  assert.match(prompt, /not canonical USER intent, governed Knowledge/u);
  assert.equal(result.proposal.requestedHelp, "COGNITIVE_ASSISTANCE", "legacy proposal metadata is Lattice-generated compatibility only");
  assert.deepEqual(result.proposal.knowledgeNeeds, []);
});
