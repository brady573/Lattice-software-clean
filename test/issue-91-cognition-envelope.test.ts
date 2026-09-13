import assert from "node:assert/strict";
import test from "node:test";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProvider, ModelProviderResult } from "../src/model/types.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

class CapturingProvider implements ModelProvider {
  readonly requests: CanonicalModelRequest[] = [];
  readonly providerName = "issue-91-fixture";
  readonly capability = Object.freeze({ transport: "test" });

  async invoke(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    return {
      response: {
        output: [{ type: "text", text: JSON.stringify({ mode: "CONVERSATION", response: "That follows from the earlier analogy." }) }],
        usage: { inputTokens: 1, outputTokens: 1 },
      },
      invocation: {
        provider: this.providerName,
        model: request.model,
        route: "fixture",
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
  assert.equal(result.response, "That follows from the earlier analogy.");
  assert.equal(provider.requests.length, 1);
  const prompt = provider.requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
  assert.match(prompt, /SOLANDRA: Think of the desk as fast temporary access/u);
  assert.match(prompt, /Use CONVERSATION for ordinary discussion/u);
  assert.match(prompt, /not canonical USER intent, governed Knowledge/u);
  assert.doesNotMatch(JSON.stringify(result), /requestedHelp|objectiveRelation|knowledgeNeeds/u);
});
