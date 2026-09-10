import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelRuntime,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";
import {
  ModelSolandraCognitiveRuntime,
  type SolandraCognitionInput,
} from "../src/solandra/cognition.js";

const SOIL_NEED = "soil preparation requirements before laying sod";
const COOKWARE_NEED = "cast iron skillet seasoning procedure";

function semanticProposal(message: string, knowledgeNeeds: string[]) {
  return {
    objectiveRelation: "NEW_OBJECTIVE",
    proposedObjective: message,
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: message.includes("soil") ? ["soil", "sod"] : ["cast iron skillet"],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds,
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    referencedOptionId: null,
  };
}

function currentUserMessage(request: CanonicalModelRequest): string {
  const user = request.messages.findLast((message) => message.role === "user")?.content ?? "";
  const match = /^Current USER message: (.*)$/mu.exec(user);
  if (!match?.[1]) throw new Error("Test provider could not find current USER message.");
  return match[1];
}

class SemanticInvestigationProvider implements ModelProvider {
  readonly kind = "semantic-investigation-fixture";
  readonly requests: CanonicalModelRequest[] = [];

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    const message = currentUserMessage(request);
    const knowledgeNeeds = /soil|sod/iu.test(message) ? [SOIL_NEED] : [COOKWARE_NEED];
    return {
      response: {
        id: `semantic-${this.requests.length}`,
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(semanticProposal(message, knowledgeNeeds)) }],
      },
      metadata: {},
    };
  }
}

class EmptyKnowledgeNeedProvider implements ModelProvider {
  readonly kind = "empty-knowledge-need-fixture";

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    const message = currentUserMessage(request);
    return {
      response: {
        id: "empty-needs",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(semanticProposal(message, [])) }],
      },
      metadata: {},
    };
  }
}

class OverBudgetKnowledgeNeedProvider implements ModelProvider {
  readonly kind = "over-budget-knowledge-need-fixture";

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    const message = currentUserMessage(request);
    return {
      response: {
        id: "over-budget-needs",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify(semanticProposal(message, [
            "surface preparation requirements",
            "application procedure",
            "post-application care",
          ])),
        }],
      },
      metadata: {},
    };
  }
}

function input(message: string, suffix: string): SolandraCognitionInput {
  return {
    conversationId: `conversation-${suffix}`,
    messageId: `message-${suffix}`,
    message,
    recentUserMessages: [message],
    governedKnowledge: [],
    governedRecommendations: [],
  };
}

test("Solandra cognition contract keeps equivalent ordinary Knowledge requests on equivalent task-bearing investigation semantics", async () => {
  const provider = new SemanticInvestigationProvider();
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "semantic-test-model");
  const cases = [
    ["I need to know how to prepare my soil for sod.", "soil-a"],
    ["How do I prepare my soil for sod?", "soil-b"],
    ["I need to know how to season a cast iron skillet.", "cookware-a"],
    ["How do I season a cast iron skillet?", "cookware-b"],
  ] as const;

  const results = [];
  for (const [message, suffix] of cases) results.push(await cognition.interpret(input(message, suffix)));

  assert.equal(results[0]?.proposal.requestedHelp, "KNOWLEDGE");
  assert.equal(results[1]?.proposal.requestedHelp, "KNOWLEDGE");
  assert.deepEqual(results[0]?.proposal.knowledgeNeeds, [SOIL_NEED]);
  assert.deepEqual(results[1]?.proposal.knowledgeNeeds, [SOIL_NEED]);
  assert.deepEqual(results[2]?.proposal.knowledgeNeeds, [COOKWARE_NEED]);
  assert.deepEqual(results[3]?.proposal.knowledgeNeeds, [COOKWARE_NEED]);

  const systemPrompt = provider.requests[0]?.messages.find((message) => message.role === "system")?.content ?? "";
  assert.match(systemPrompt, /knowledgeNeeds must contain one to 2 concise task-bearing investigation needs/iu);
  assert.match(systemPrompt, /together preserve the full material answer burden/iu);
  assert.match(systemPrompt, /may use different wording or decomposition, but they must preserve materially equivalent investigation opportunity/iu);
  assert.doesNotMatch(systemPrompt, /How do I prepare my soil|cast iron skillet/iu);
});

test("configured model cognition fails closed instead of silently handing an empty Knowledge plan to lexical fallback", async () => {
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new EmptyKnowledgeNeedProvider()),
    "semantic-test-model",
  );

  await assert.rejects(
    () => cognition.interpret(input("How can I prepare this surface?", "empty")),
    /task-bearing Knowledge investigation need/iu,
  );
});

test("configured model cognition fails closed instead of allowing downstream query truncation to drop investigation burden", async () => {
  const cognition = new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new OverBudgetKnowledgeNeedProvider()),
    "semantic-test-model",
  );

  await assert.rejects(
    () => cognition.interpret(input("How should I prepare and finish this surface?", "over-budget")),
    /full material Knowledge investigation burden within 2 task-bearing needs/iu,
  );
});
