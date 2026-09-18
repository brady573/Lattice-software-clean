import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { ModelProviderError } from "../src/model/errors.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  isConversationalCognition,
  ModelSolandraCognitiveRuntime,
} from "../src/solandra/cognition.js";

const MODEL = "issue-91-minimal-projection-fixture";

function governedProjection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "GOVERNED",
    projection: {
      objectiveRelation: "CONTINUE",
      proposedObjective: null,
      requestedHelp: null,
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
      referencedIntentProposalId: null,
      ...overrides,
    },
  };
}

function providerResult(
  request: CanonicalModelRequest,
  body: Record<string, unknown>,
  id: string,
): ModelProviderResult {
  return {
    response: {
      id,
      model: request.model,
      output: [{ type: "text", text: JSON.stringify(body) }],
    },
    route: {
      actualProvider: "issue-91-minimal-projection-fixture",
      actualModel: request.model,
      upstreamRequestId: id,
    },
  };
}

class SequenceProvider implements ModelProvider {
  readonly kind = "issue-91-minimal-projection-fixture";
  readonly requests: CanonicalModelRequest[] = [];
  private index = 0;

  constructor(private readonly outputs: readonly Record<string, unknown>[]) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.requests.push(structuredClone(request));
    const body = this.outputs[this.index];
    if (!body) throw new Error(`Unexpected cognition call ${this.index + 1}.`);
    this.index += 1;
    return providerResult(request, body, `issue-91-minimal-projection-${this.index}`);
  }
}

function cognitionFor(...outputs: Record<string, unknown>[]): ModelSolandraCognitiveRuntime {
  return new ModelSolandraCognitiveRuntime(
    new ModelRuntime(new SequenceProvider(outputs)),
    MODEL,
  );
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-91-minimal-projection-user",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(created.statusCode, 201, created.body);
  return created.json<{ conversation: { id: string } }>().conversation.id;
}

test("unknown requestedHelp wording is demoted to no governed capability while material ambiguity survives", async () => {
  const cognition = cognitionFor(governedProjection({
    objectiveRelation: "CONTINUE",
    requestedHelp: "UNRECOGNIZED_NON_AUTHORITATIVE_HINT",
    materialAmbiguity: {
      question: "Which matters more to you: using less water or spending less time checking the plants?",
      couldChangeObjective: true,
    },
  }));

  const result = await cognition.interpret({
    conversationId: "projection-ambiguity",
    messageId: "projection-ambiguity-message",
    message: "Which approach is better if I have not said which tradeoff matters more?",
    currentObjective: "Choose a low-maintenance way to care for balcony plants.",
    recentUserMessages: [
      "Choose a low-maintenance way to care for balcony plants.",
      "Which approach is better if I have not said which tradeoff matters more?",
    ],
    governedKnowledge: [],
  });

  assert.equal(isConversationalCognition(result), false);
  if (isConversationalCognition(result)) assert.fail("expected transient governed projection");
  assert.equal(result.proposal.requestedHelp, null);
  assert.equal(
    result.proposal.materialAmbiguity?.question,
    "Which matters more to you: using less water or spending less time checking the plants?",
  );
});

test("held-out ambiguous comparison reaches useful clarification without an exact help taxonomy value", async () => {
  const cognition = cognitionFor(
    governedProjection({
      objectiveRelation: "NEW_OBJECTIVE",
      requestedHelp: "DECISION",
    }),
    governedProjection({
      objectiveRelation: "CONTINUE",
      requestedHelp: "ORDINARY_COMPARISON",
      materialAmbiguity: {
        question: "Which matters more to you: saving water or reducing how often you need to check the plants?",
        couldChangeObjective: true,
      },
    }),
  );
  const app = await createRuntimeApp(config, {
    solandraCognition: cognition,
    memoryDispatchDelayMs: 1_000,
  });
  try {
    const conversationId = await createConversation(app);
    const setup = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "garden-setup",
        message: "Help me choose between a rain barrel and a soil-moisture timer for my balcony plants.",
      },
    });
    assert.equal(setup.statusCode, 202, setup.body);

    const followup = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "garden-ambiguity",
        message: "Which one is better if I have not said whether saving water or reducing daily attention matters more?",
      },
    });
    assert.equal(followup.statusCode, 202, followup.body);
    const body = followup.json<{
      status: string;
      question: string;
      interpretation: { requestedHelp: string | null };
    }>();
    assert.equal(body.status, "NEEDS_CLARIFICATION");
    assert.match(body.question, /saving water|reducing how often/iu);
    assert.equal(body.interpretation.requestedHelp, null);
  } finally {
    await app.close();
  }
});

test("ordinary ellipsis remains natural conversation without any governed taxonomy projection", async () => {
  const cognition = cognitionFor({
    mode: "CONVERSATION",
    response: "Use the smaller whisk too; the same mixing principle applies, just with a shorter stroke.",
  });
  const result = await cognition.interpret({
    conversationId: "ellipsis-conversation",
    messageId: "ellipsis-message",
    message: "And for the smaller bowl?",
    recentUserMessages: [
      "How should I whisk this dressing without splashing it?",
      "And for the smaller bowl?",
    ],
    recentConversation: [
      { role: "USER", content: "How should I whisk this dressing without splashing it?" },
      { role: "SOLANDRA", content: "Use a compact circular motion and keep the whisk low in the bowl." },
      { role: "USER", content: "And for the smaller bowl?" },
    ],
    governedKnowledge: [],
  });

  assert.equal(result.mode, "CONVERSATION");
  if (!isConversationalCognition(result)) assert.fail("expected ordinary conversational continuation");
  assert.match(result.response, /smaller whisk|shorter stroke/iu);
});

test("ordinary correction can project Intent meaning without selecting an unrelated governed capability", async () => {
  const correction =
    "No, I meant I want to shorten the rehearsal itself, not move it earlier in the day.";
  const cognition = cognitionFor(
    governedProjection({
      objectiveRelation: "NEW_OBJECTIVE",
      requestedHelp: "DECISION",
    }),
    governedProjection({
      objectiveRelation: "CORRECTION",
      proposedObjective: correction,
      requestedHelp: "REFINE_CONTEXT",
    }),
  );
  const app = await createRuntimeApp(config, {
    solandraCognition: cognition,
    memoryDispatchDelayMs: 1_000,
  });
  try {
    const conversationId = await createConversation(app);
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "rehearsal-setup",
        message: "Help me make my presentation rehearsal easier to fit into the evening.",
      },
    });
    assert.equal(first.statusCode, 202, first.body);

    const corrected = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "rehearsal-correction", message: correction },
    });
    assert.equal(corrected.statusCode, 202, corrected.body);
    const body = corrected.json<{
      status: string;
      acceptedUnderstanding: string;
      interpretation: { requestedHelp: string | null };
    }>();
    assert.equal(body.status, "RUN_ACCEPTED");
    assert.equal(body.acceptedUnderstanding, correction);
    assert.equal(body.interpretation.requestedHelp, null);
  } finally {
    await app.close();
  }
});

test("an exact governed option boundary still fails closed without exact Recommendation and option identities", async () => {
  const cognition = cognitionFor(governedProjection({
    requestedHelp: "ACCEPT_CHOICE",
  }));

  await assert.rejects(
    cognition.interpret({
      conversationId: "exact-option-boundary",
      messageId: "exact-option-boundary-message",
      message: "Use that one.",
      currentObjective: "Choose a maintenance schedule.",
      recentUserMessages: ["Choose a maintenance schedule.", "Use that one."],
      governedKnowledge: [],
      governedRecommendations: [],
    }),
    (error: unknown) => error instanceof ModelProviderError
      && error.code === "invalid_output"
      && /option reference projection must identify supplied Recommendation and option/iu.test(error.message),
  );
});


test("governed shape advertises only valid governed capability selectors plus null", async () => {
  const provider = new SequenceProvider([{
    mode: "CONVERSATION",
    response: "No governed capability is needed for this ordinary turn.",
  }]);
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), MODEL);
  await cognition.interpret({
    conversationId: "governed-vocabulary",
    messageId: "governed-vocabulary-message",
    message: "Talk this through with me.",
    recentUserMessages: ["Talk this through with me."],
    governedKnowledge: [],
  });

  const prompt = provider.requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
  const governedShapeLine = prompt.split("\n").find((line) => line.includes('"requestedHelp"')) ?? "";
  assert.match(governedShapeLine, /CONFIRM_INTENT\|RESOURCE\|null/u);
  assert.doesNotMatch(governedShapeLine, /COGNITIVE_ASSISTANCE/u);
});
