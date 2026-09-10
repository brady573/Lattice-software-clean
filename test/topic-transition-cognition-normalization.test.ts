import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

class SemanticProposalProvider implements ModelProvider {
  readonly kind = "topic-transition-semantic-proposal";

  constructor(
    private readonly objectiveRelation: "NEW_OBJECTIVE" | "CONTINUE" | "CORRECTION",
    private readonly proposedObjective: string | null,
  ) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "topic-transition-semantic-proposal-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            objectiveRelation: this.objectiveRelation,
            proposedObjective: this.proposedObjective,
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
        upstreamRequestId: "topic-transition-semantic-proposal-request",
      },
    };
  }
}

test("Solandra correction semantics are not overwritten by deterministic USER-phrase reparsing", async () => {
  const message = "Actually, I mean cameras for indoor low-light photos.";
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new SemanticProposalProvider("CORRECTION", null)),
    "topic-transition-correction-model",
  );
  const result = await cognition.interpret({
    conversationId: "topic-transition-correction",
    messageId: "topic-transition-correction-message",
    message,
    currentObjective: "Help me compare cameras for hiking.",
    recentUserMessages: ["Help me compare cameras for hiking.", message],
    governedKnowledge: [],
  });

  assert.equal(result.proposal.objectiveRelation, "CORRECTION");
  assert.equal(result.proposal.proposedObjective, null);
  assert.equal(result.proposal.materialAmbiguity, null);
});

test("model-proposed exact USER correction remains non-authoritative semantic output", async () => {
  const message = "Use indoor low-light photography as the objective instead.";
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new SemanticProposalProvider("CORRECTION", message)),
    "topic-transition-correction-model",
  );
  const result = await cognition.interpret({
    conversationId: "topic-transition-exact-correction",
    messageId: "topic-transition-exact-correction-message",
    message,
    currentObjective: "Help me compare cameras for hiking.",
    recentUserMessages: ["Help me compare cameras for hiking.", message],
    governedKnowledge: [],
  });

  assert.equal(result.proposal.objectiveRelation, "CORRECTION");
  assert.equal(result.proposal.proposedObjective, message);
  assert.equal(result.proposal.materialAmbiguity, null);
});
