import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

class NullCorrectionObjectiveProvider implements ModelProvider {
  readonly kind = "topic-transition-null-correction";

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "topic-transition-null-correction-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            objectiveRelation: "CORRECTION",
            proposedObjective: null,
            requestedHelp: "KNOWLEDGE",
            relevantContext: [],
            entities: [],
            referents: [],
            constraints: [],
            preferences: [],
            knowledgeNeeds: [],
            materialAmbiguity: null,
            referencedKnowledgeId: null,
            referencedRecommendationId: null,
            referencedOptionId: null,
          }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "topic-transition-null-correction-request",
      },
    };
  }
}

test("explicit USER correction remains a successor objective when model omits proposedObjective", async () => {
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new NullCorrectionObjectiveProvider()),
    "topic-transition-correction-model",
  );
  const message = "Actually, I mean cameras for indoor low-light photos.";
  const result = await cognition.interpret({
    conversationId: "topic-transition-correction",
    messageId: "topic-transition-correction-message",
    message,
    currentObjective: "Help me compare cameras for hiking.",
    recentUserMessages: ["Help me compare cameras for hiking.", message],
    governedKnowledge: [],
  });

  assert.equal(result.proposal.objectiveRelation, "CORRECTION");
  assert.equal(result.proposal.proposedObjective, message);
  assert.equal(result.proposal.materialAmbiguity, null);
});

test("ordinary follow-up is not rewritten as an explicit correction", async () => {
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new NullCorrectionObjectiveProvider()),
    "topic-transition-correction-model",
  );
  const result = await cognition.interpret({
    conversationId: "topic-transition-follow-up",
    messageId: "topic-transition-follow-up-message",
    message: "Why?",
    currentObjective: "Why do maple leaves change color?",
    recentUserMessages: ["Why do maple leaves change color?", "Why?"],
    governedKnowledge: [],
  });

  assert.equal(result.proposal.objectiveRelation, "CORRECTION");
  assert.equal(result.proposal.proposedObjective, null);
});
