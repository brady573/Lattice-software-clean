import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "topic-transition-fixture",
  requestedModel: "topic-transition-fixture",
  actualProvider: "topic-transition-fixture",
  actualModel: "topic-transition-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "topic-transition-fixture-request",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
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
    ...overrides,
  };
}

class TopicTransitionCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const message = input.message.trim();
    if (!input.currentObjective) {
      return { proposal: proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: message }), invocationProvenance: PROVENANCE };
    }
    if (message === "How should I prepare soil for new sod?" || message === "Help me choose a quiet mechanical keyboard for shared office use.") {
      return { proposal: proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: message }), invocationProvenance: PROVENANCE };
    }
    if (message === "Why?" || message === "Explain that more simply." || message === "What are your sources?") {
      return { proposal: proposal({ objectiveRelation: "CONTINUE", proposedObjective: null }), invocationProvenance: PROVENANCE };
    }
    if (message === "Actually, explain corrosion of stainless steel instead.") {
      return { proposal: proposal({ objectiveRelation: "CORRECTION", proposedObjective: message }), invocationProvenance: PROVENANCE };
    }
    if (message === "What about the other one?") {
      return {
        proposal: proposal({
          objectiveRelation: "CONTINUE",
          materialAmbiguity: {
            question: "Do you mean the current topic, or do you want to start a different topic?",
            couldChangeObjective: true,
          },
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return { proposal: proposal(), invocationProvenance: PROVENANCE };
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function submit(app: FastifyInstance, conversationId: string, turnId: string, message: string) {
  return await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId, message },
  });
}

test("clear unrelated topic creates successor Intent and binds Run to exact new USER task", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 25, solandraCognition: cognition });
  try {
    const conversationId = await createConversation(app);
    const firstMessage = "Why does iron rust?";
    const first = await submit(app, conversationId, "topic-a", firstMessage);
    assert.equal(first.statusCode, 202, first.body);
    const firstBody = first.json<{ intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(firstBody.acceptedUnderstanding, firstMessage);

    const secondMessage = "How should I prepare soil for new sod?";
    const second = await submit(app, conversationId, "topic-b", secondMessage);
    assert.equal(second.statusCode, 202, second.body);
    const secondBody = second.json<{
      runId: string;
      intentVersionId: string;
      acceptedUnderstanding: string;
      provenance: { messageId: string };
      interpretation: { objectiveRelation: string };
    }>();
    assert.equal(secondBody.interpretation.objectiveRelation, "NEW_OBJECTIVE");
    assert.equal(secondBody.acceptedUnderstanding, secondMessage);
    assert.notEqual(secondBody.intentVersionId, firstBody.intentVersionId);

    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${secondBody.runId}` });
    assert.equal(run.statusCode, 200, run.body);
    const persisted = run.json<{
      request: { objective: string; sourceMessageId: string; intentVersionId: string };
    }>();
    assert.equal(persisted.request.objective, secondMessage);
    assert.equal(persisted.request.sourceMessageId, secondBody.provenance.messageId);
    assert.equal(persisted.request.intentVersionId, secondBody.intentVersionId);
  } finally {
    await app.close();
  }
});

test("same-topic follow-up preserves current Intent while explicit correction creates successor lineage", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 25, solandraCognition: cognition });
  try {
    const conversationId = await createConversation(app);
    const initial = await submit(app, conversationId, "follow-a", "Why does iron rust?");
    assert.equal(initial.statusCode, 202, initial.body);
    const initialVersion = initial.json<{ intentVersionId: string }>().intentVersionId;

    const follow = await submit(app, conversationId, "follow-b", "Why?");
    assert.equal(follow.statusCode, 202, follow.body);
    assert.equal(follow.json().intentVersionId, initialVersion);
    assert.equal(follow.json().acceptedUnderstanding, "Why does iron rust?");

    const correctionMessage = "Actually, explain corrosion of stainless steel instead.";
    const correction = await submit(app, conversationId, "follow-c", correctionMessage);
    assert.equal(correction.statusCode, 202, correction.body);
    assert.notEqual(correction.json().intentVersionId, initialVersion);
    assert.equal(correction.json().acceptedUnderstanding, correctionMessage);
  } finally {
    await app.close();
  }
});

test("material objective ambiguity asks minimum clarification without replacing current Intent", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 25, solandraCognition: cognition });
  try {
    const conversationId = await createConversation(app);
    const initial = await submit(app, conversationId, "amb-a", "Why does iron rust?");
    assert.equal(initial.statusCode, 202, initial.body);
    const initialVersion = initial.json<{ intentVersionId: string }>().intentVersionId;

    const ambiguous = await submit(app, conversationId, "amb-b", "What about the other one?");
    assert.equal(ambiguous.statusCode, 202, ambiguous.body);
    const body = ambiguous.json<{ status: string; intentVersionId: string; acceptedUnderstanding: string; question: string }>();
    assert.equal(body.status, "NEEDS_CLARIFICATION");
    assert.equal(body.intentVersionId, initialVersion);
    assert.equal(body.acceptedUnderstanding, "Why does iron rust?");
    assert.match(body.question, /current topic|different topic/iu);
  } finally {
    await app.close();
  }
});

test("unrelated-domain transition is generic across science to gardening and writing to consumer decision", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 25, solandraCognition: cognition });
  try {
    const conversationId = await createConversation(app);
    const writing = await submit(app, conversationId, "generic-a", "Rewrite this paragraph so it sounds friendlier.");
    assert.equal(writing.statusCode, 202, writing.body);
    const writingVersion = writing.json<{ intentVersionId: string }>().intentVersionId;

    const consumerMessage = "Help me choose a quiet mechanical keyboard for shared office use.";
    const consumer = await submit(app, conversationId, "generic-b", consumerMessage);
    assert.equal(consumer.statusCode, 202, consumer.body);
    assert.notEqual(consumer.json().intentVersionId, writingVersion);
    assert.equal(consumer.json().acceptedUnderstanding, consumerMessage);
  } finally {
    await app.close();
  }
});
