import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { isConversationalCognition, ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

class GovernedCognitionProvider implements ModelProvider {
  readonly kind = "m1-governed-cognition";

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "m1-governed-cognition-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            mode: "GOVERNED",
            response: null,
            projection: {
              objectiveRelation: "NEW_OBJECTIVE",
              proposedObjective: "A non-authoritative normalized objective.",
              requestedHelp: "FRESH_RESEARCH",
              relevantContext: [],
              entities: [],
              referents: [],
              constraints: [],
              preferences: [],
              knowledgeNeeds: ["current external information needed to answer the request"],
              materialAmbiguity: null,
              referencedKnowledgeId: null,
              referencedRecommendationId: null,
              referencedOptionId: null,
            },
          }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "m1-governed-cognition-request",
      },
    };
  }
}

test("strict governed cognition preserves requested-help semantics without redundant next-step metadata", async () => {
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new GovernedCognitionProvider()),
    "m1-cognition-contract-model",
  );
  const result = await cognition.interpret({
    conversationId: "m1-cognition-contract",
    messageId: "m1-cognition-contract-message",
    message: "Find current information needed to answer this question.",
    recentUserMessages: ["Find current information needed to answer this question."],
    governedKnowledge: [],
  });

  if (isConversationalCognition(result)) assert.fail("expected governed cognition");
  assert.equal(result.proposal.requestedHelp, "FRESH_RESEARCH");
  assert.deepEqual(result.proposal.knowledgeNeeds, ["current external information needed to answer the request"]);
  assert.equal(result.proposal.proposedNextStep, undefined);
  assert.equal(result.invocationProvenance.actualProvider, "m1-governed-cognition");
});
