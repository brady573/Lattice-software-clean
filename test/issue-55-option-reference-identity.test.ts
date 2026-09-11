import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import {
  ModelSolandraCognitiveRuntime,
  type SolandraGovernedRecommendationContext,
  type SolandraSemanticProposal,
} from "../src/solandra/cognition.js";

const SHARED_OPTION_ID = "option-1";

function recommendation(
  recommendationId: string,
  optionId = SHARED_OPTION_ID,
): SolandraGovernedRecommendationContext {
  return {
    recommendationId,
    recommendation: `Recommendation ${recommendationId}`,
    intentVersionId: `intent-${recommendationId}`,
    knowledgeIds: [],
    createdAt: "2026-09-10T00:00:00.000Z",
    options: [{
      optionId,
      position: 1,
      text: `Option for ${recommendationId}`,
      recommended: true,
    }],
  };
}

function proposal(
  recommendationId: string,
  optionId: string,
): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "EXPLAIN_OPTION",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: [],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: recommendationId,
    referencedOptionId: optionId,
  };
}

class ProposalProvider implements ModelProvider {
  readonly kind = "issue-55-proposal-provider";
  calls = 0;

  constructor(private readonly responseProposal: SolandraSemanticProposal) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    return {
      response: {
        id: `issue-55-response-${this.calls}`,
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.responseProposal) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `issue-55-request-${this.calls}`,
      },
    };
  }
}

async function interpret(
  responseProposal: SolandraSemanticProposal,
  governedRecommendations: readonly SolandraGovernedRecommendationContext[],
  messageId: string,
) {
  const provider = new ProposalProvider(responseProposal);
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "issue-55-model");
  const result = await cognition.interpret({
    conversationId: "issue-55-conversation",
    messageId,
    message: "Tell me about that option.",
    currentObjective: "Choose between prior options.",
    recentUserMessages: ["Choose between prior options.", "Tell me about that option."],
    governedKnowledge: [],
    governedRecommendations,
  });
  return { result, calls: provider.calls };
}

test("Issue #55: the same local optionId resolves independently under two Recommendations", async () => {
  const recommendationA = recommendation("recommendation-a");
  const recommendationB = recommendation("recommendation-b");

  const resolvedA = await interpret(
    proposal(recommendationA.recommendationId, SHARED_OPTION_ID),
    [recommendationA, recommendationB],
    "issue-55-a",
  );
  assert.equal(resolvedA.result.proposal.referencedRecommendationId, recommendationA.recommendationId);
  assert.equal(resolvedA.result.proposal.referencedOptionId, SHARED_OPTION_ID);
  assert.equal(resolvedA.calls, 1);

  const resolvedB = await interpret(
    proposal(recommendationB.recommendationId, SHARED_OPTION_ID),
    [recommendationA, recommendationB],
    "issue-55-b",
  );
  assert.equal(resolvedB.result.proposal.referencedRecommendationId, recommendationB.recommendationId);
  assert.equal(resolvedB.result.proposal.referencedOptionId, SHARED_OPTION_ID);
  assert.equal(resolvedB.calls, 1);
});

test("Issue #55: Recommendation input order cannot change composite option resolution", async () => {
  const recommendationA = recommendation("recommendation-a");
  const recommendationB = recommendation("recommendation-b");

  for (const [index, recommendations] of [
    [recommendationA, recommendationB],
    [recommendationB, recommendationA],
  ].entries()) {
    const resolved = await interpret(
      proposal(recommendationA.recommendationId, SHARED_OPTION_ID),
      recommendations,
      `issue-55-order-${index}`,
    );
    assert.equal(resolved.result.proposal.referencedRecommendationId, recommendationA.recommendationId);
    assert.equal(resolved.result.proposal.referencedOptionId, SHARED_OPTION_ID);
  }
});

test("Issue #55: a valid Recommendation with an invalid local optionId fails closed", async () => {
  const recommendationA = recommendation("recommendation-a");
  await assert.rejects(
    interpret(
      proposal(recommendationA.recommendationId, "invented-option"),
      [recommendationA],
      "issue-55-invalid-option",
    ),
    /option that Lattice did not supply for the referenced Recommendation/u,
  );
});

test("Issue #55: an invalid Recommendation identity fails closed before option resolution", async () => {
  const recommendationA = recommendation("recommendation-a");
  await assert.rejects(
    interpret(
      proposal("invented-recommendation", SHARED_OPTION_ID),
      [recommendationA],
      "issue-55-invalid-recommendation",
    ),
    /Recommendation that was not supplied by Lattice/u,
  );
});

test("Issue #55: existing unique-option reference behavior remains valid", async () => {
  const recommendationA = recommendation("recommendation-a", "unique-option-a");
  const recommendationB = recommendation("recommendation-b", "unique-option-b");
  const resolved = await interpret(
    proposal(recommendationB.recommendationId, "unique-option-b"),
    [recommendationA, recommendationB],
    "issue-55-unique",
  );

  assert.equal(resolved.result.proposal.referencedRecommendationId, recommendationB.recommendationId);
  assert.equal(resolved.result.proposal.referencedOptionId, "unique-option-b");
}