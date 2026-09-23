import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import {
  isConversationalCognition,
  ModelSolandraCognitiveRuntime,
  type SolandraSemanticProposal,
} from "../src/solandra/cognition.js";

class CapturingCognitionProvider implements ModelProvider {
  readonly kind = "issue-91-historical-knowledge-contract";
  readonly requests: CanonicalModelRequest[] = [];

  constructor(private readonly projection: SolandraSemanticProposal) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    return {
      response: {
        id: `response-${this.requests.length}`,
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({ mode: "GOVERNED", projection: this.projection }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `request-${this.requests.length}`,
      },
    };
  }
}

function proposal(overrides: Partial<SolandraSemanticProposal>): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "SOURCES_REFERENCE",
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
    ...overrides,
  };
}

function messageContent(request: CanonicalModelRequest, role: "system" | "user"): string {
  const message = request.messages.find((item) => item.role === role);
  assert.ok(message);
  assert.equal(typeof message.content, "string");
  return message.content;
}

test("historical Knowledge remains addressable when its governed result is sparse or uncertain", async () => {
  const knowledgeId = "knowledge_sparse_history";
  const provider = new CapturingCognitionProvider(proposal({
    requestedHelp: "SOURCES_REFERENCE",
    referencedKnowledgeId: knowledgeId,
  }));
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "issue-91-contract-model");

  const result = await cognition.interpret({
    conversationId: "conversation-sparse-history",
    messageId: "message-sparse-history",
    message: "What support did the earlier investigation have?",
    currentObjective: "Establish the earlier factual question from external evidence.",
    recentUserMessages: [],
    governedKnowledge: [{
      knowledgeId,
      objective: "Establish the earlier factual question from external evidence.",
      findings: [],
      sourceCount: 0,
      uncertainties: ["No validated external findings were sufficiently relevant."],
    }],
  });

  if (isConversationalCognition(result)) assert.fail("expected governed cognition");
  assert.equal(result.proposal.requestedHelp, "SOURCES_REFERENCE");
  assert.equal(result.proposal.referencedKnowledgeId, knowledgeId);

  const request = provider.requests.at(-1);
  assert.ok(request);
  const system = messageContent(request, "system");
  assert.match(system, /Sparse historical Knowledge remains established state/);
  assert.match(system, /no admitted source, still use SOURCES_REFERENCE/);
  assert.match(system, /Do not infer a fresh-research request merely because prior Knowledge is sparse/);

  const user = messageContent(request, "user");
  assert.match(user, new RegExp(`Knowledge ID: ${knowledgeId}`));
  assert.match(user, /Findings: none/);
  assert.match(user, /Source count: 0/);
  assert.match(user, /No validated external findings were sufficiently relevant/);
});

test("fresh research remains a valid governed request when new acquisition is materially needed beyond history", async () => {
  const provider = new CapturingCognitionProvider(proposal({
    requestedHelp: "FRESH_RESEARCH",
    referencedKnowledgeId: null,
    knowledgeNeeds: ["new external evidence published after the historical Knowledge state"],
  }));
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "issue-91-contract-model");

  const result = await cognition.interpret({
    conversationId: "conversation-fresh-after-history",
    messageId: "message-fresh-after-history",
    message: "Please investigate whether newer evidence changes the earlier conclusion.",
    currentObjective: "Understand the historical evidence about the topic.",
    recentUserMessages: [],
    governedKnowledge: [{
      knowledgeId: "knowledge_prior_supported",
      objective: "Understand the historical evidence about the topic.",
      findings: [{ claimId: "claim-1", status: "SUPPORTED", text: "The prior source reported the historical result." }],
      sourceCount: 1,
      uncertainties: [],
    }],
  });

  if (isConversationalCognition(result)) assert.fail("expected governed cognition");
  assert.equal(result.proposal.requestedHelp, "FRESH_RESEARCH");
  assert.equal(result.proposal.referencedKnowledgeId, null);
  assert.deepEqual(result.proposal.knowledgeNeeds, [
    "new external evidence published after the historical Knowledge state",
  ]);

  const request = provider.requests.at(-1);
  assert.ok(request);
  const system = messageContent(request, "system");
  assert.match(system, /Use FRESH_RESEARCH only when the USER materially needs new, updated, or additional external factual acquisition beyond the supplied governed Knowledge/);
});


test("historical Knowledge transformation coreference stays on the governed reference contract", async () => {
  const knowledgeId = "knowledge_prior_plain_language";
  const provider = new CapturingCognitionProvider(proposal({
    requestedHelp: "SIMPLIFY_REFERENCE",
    referencedKnowledgeId: knowledgeId,
  }));
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "issue-20-contract-model");

  const result = await cognition.interpret({
    conversationId: "conversation-prior-plain-language",
    messageId: "message-prior-plain-language",
    message: "Can you restate the result we already established so a non-specialist can follow it?",
    currentObjective: "Understand what the external evidence established about a technical topic.",
    recentUserMessages: [],
    governedKnowledge: [{
      knowledgeId,
      objective: "Understand what the external evidence established about a technical topic.",
      findings: [{
        claimId: "claim-prior-plain-language",
        status: "SUPPORTED",
        text: "The established evidence supports the technical result under the stated conditions.",
      }],
      sourceCount: 1,
      uncertainties: ["The result remains bounded to the established conditions."],
    }],
  });

  if (isConversationalCognition(result)) assert.fail("expected governed cognition");
  assert.equal(result.proposal.requestedHelp, "SIMPLIFY_REFERENCE");
  assert.equal(result.proposal.referencedKnowledgeId, knowledgeId);

  const request = provider.requests.at(-1);
  assert.ok(request);
  const system = messageContent(request, "system");
  assert.match(system, /Historical Knowledge references may be implicit through ordinary conversational coreference/);
  assert.match(system, /Do not use CONVERSATION to transform prior Solandra factual content when supplied governed Knowledge is the factual basis/);
  assert.match(system, /use the matching EXPLAIN_REFERENCE or SIMPLIFY_REFERENCE mode/);

  const user = messageContent(request, "user");
  assert.match(user, new RegExp(`Knowledge ID: ${knowledgeId}`));
  assert.match(user, /The established evidence supports the technical result under the stated conditions/);
  assert.match(user, /The result remains bounded to the established conditions/);
});
