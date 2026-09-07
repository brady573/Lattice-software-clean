import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

class RedundantMetadataProvider implements ModelProvider {
  readonly kind = "m1-redundant-cognition-metadata";

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "m1-redundant-cognition-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
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
            proposedNextStep: "FRESH_RESEARCH",
          }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "m1-redundant-cognition-request",
      },
    };
  }
}

test("redundant non-authoritative next-step metadata cannot block Solandra cognition", async () => {
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new RedundantMetadataProvider()),
    "m1-cognition-contract-model",
  );
  const result = await cognition.interpret({
    conversationId: "m1-cognition-contract",
    messageId: "m1-cognition-contract-message",
    message: "Find current information needed to answer this question.",
    recentUserMessages: ["Find current information needed to answer this question."],
    governedKnowledge: [],
  });

  assert.equal(result.proposal.requestedHelp, "FRESH_RESEARCH");
  assert.deepEqual(result.proposal.knowledgeNeeds, ["current external information needed to answer the request"]);
  assert.equal(result.proposal.proposedNextStep, "FRESH_RESEARCH");
  assert.equal(result.invocationProvenance.actualProvider, "m1-redundant-cognition-metadata");
});
