import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelInvocationProvenance, ModelProviderResult } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  ModelSolandraCognitiveRuntime,
  type SolandraCognitionInput,
  type SolandraCognitionResult,
  type SolandraCognitiveRuntime,
  type SolandraSemanticProposal,
} from "../src/solandra/cognition.js";

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

class TopicFixtureCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    const message = input.message.trim();
    if (!input.currentObjective) {
      return { proposal: proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: message }), invocationProvenance: PROVENANCE };
    }
    if (message === "How should I prepare soil for new sod?" || message === "Plan a simple weekend budget for a museum trip.") {
      return { proposal: proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: message }), invocationProvenance: PROVENANCE };
    }
    if (message === "Why?" || message === "Explain that more simply.") {
      return { proposal: proposal({ objectiveRelation: "CONTINUE" }), invocationProvenance: PROVENANCE };
    }
    if (message === "Actually, I mean rust on outdoor steel furniture.") {
      return { proposal: proposal({ objectiveRelation: "CORRECTION", proposedObjective: message }), invocationProvenance: PROVENANCE };
    }
    if (message === "What about the other one?") {
      return {
        proposal: proposal({
          objectiveRelation: "CONTINUE",
          materialAmbiguity: {
            question: "Do you mean the current rust question or a different topic?",
            couldChangeObjective: true,
          },
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return { proposal: proposal({ objectiveRelation: "CONTINUE" }), invocationProvenance: PROVENANCE };
  }
}

class CapturingProvider implements ModelProvider {
  readonly kind = "topic-transition-contract";
  request?: CanonicalModelRequest;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.request = structuredClone(request);
    return {
      response: {
        id: "topic-transition-contract-response",
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(proposal({ objectiveRelation: "CONTINUE" })) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: "topic-transition-contract-upstream",
      },
    };
  }
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function submit(app: FastifyInstance, conversationId: string, message: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
}

test("canonical cognition request defines objective-relation behavior rather than only listing enum labels", async () => {
  const provider = new CapturingProvider();
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "topic-transition-contract-model");
  await cognition.interpret({
    conversationId: "topic-transition-contract",
    messageId: "topic-transition-contract-message",
    message: "How should I prepare soil for new sod?",
    currentObjective: "Why does iron rust?",
    recentUserMessages: ["Why does iron rust?", "How should I prepare soil for new sod?"],
    governedKnowledge: [],
  });

  const system = provider.request?.messages.find((message) => message.role === "system")?.content ?? "";
  assert.match(system, /NEW_OBJECTIVE[^\n]+materially different/iu);
  assert.match(system, /CONTINUE[^\n]+same objective/iu);
  assert.match(system, /CORRECTION[^\n]+correct/iu);
  assert.match(system, /unclear[^\n]+materialAmbiguity/iu);
});

test("clear topic changes create successor Intent while contextual follow-up preserves it", async () => {
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline" } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 50, solandraCognition: new TopicFixtureCognition() });
  try {
    const conversationId = await createConversation(app);
    const first = await submit(app, conversationId, "Why does iron rust?");
    assert.equal(first.statusCode, 202, first.body);
    const a = first.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(a.acceptedUnderstanding, "Why does iron rust?");

    const second = await submit(app, conversationId, "How should I prepare soil for new sod?");
    assert.equal(second.statusCode, 202, second.body);
    const b = second.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(b.acceptedUnderstanding, "How should I prepare soil for new sod?");
    assert.notEqual(b.intentVersionId, a.intentVersionId);

    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${b.runId}` });
    assert.equal(run.statusCode, 200, run.body);
    const durable = run.json<{ request: { sourceMessageId: string; intentVersionId: string; objective: string } }>();
    assert.equal(durable.request.intentVersionId, b.intentVersionId);
    assert.equal(durable.request.objective, "How should I prepare soil for new sod?");

    const followup = await submit(app, conversationId, "Why?");
    assert.equal(followup.statusCode, 202, followup.body);
    const c = followup.json<{ intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(c.intentVersionId, b.intentVersionId);
    assert.equal(c.acceptedUnderstanding, "How should I prepare soil for new sod?");
  } finally {
    await app.close();
  }
});

test("explicit correction keeps lineage and material ambiguity asks before changing objective", async () => {
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline" } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 50, solandraCognition: new TopicFixtureCognition() });
  try {
    const conversationId = await createConversation(app);
    const first = await submit(app, conversationId, "Why does iron rust?");
    assert.equal(first.statusCode, 202, first.body);
    const a = first.json<{ intentVersionId: string }>();

    const correction = await submit(app, conversationId, "Actually, I mean rust on outdoor steel furniture.");
    assert.equal(correction.statusCode, 202, correction.body);
    const b = correction.json<{ intentVersionId: string; acceptedUnderstanding: string }>();
    assert.notEqual(b.intentVersionId, a.intentVersionId);
    assert.equal(b.acceptedUnderstanding, "Actually, I mean rust on outdoor steel furniture.");

    const ambiguous = await submit(app, conversationId, "What about the other one?");
    assert.equal(ambiguous.statusCode, 202, ambiguous.body);
    const c = ambiguous.json<{ status: string; intentVersionId: string; acceptedUnderstanding: string; question: string }>();
    assert.equal(c.status, "NEEDS_CLARIFICATION");
    assert.equal(c.intentVersionId, b.intentVersionId);
    assert.equal(c.acceptedUnderstanding, "Actually, I mean rust on outdoor steel furniture.");
    assert.match(c.question, /current rust question or a different topic/iu);
  } finally {
    await app.close();
  }
});

test("unrelated transitions are domain-general rather than tied to one example", async () => {
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline" } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, { memoryDispatchDelayMs: 50, solandraCognition: new TopicFixtureCognition() });
  try {
    const conversationId = await createConversation(app);
    const first = await submit(app, conversationId, "Rewrite this paragraph so it sounds warmer.");
    assert.equal(first.statusCode, 202, first.body);
    const a = first.json<{ intentVersionId: string }>();

    const second = await submit(app, conversationId, "Plan a simple weekend budget for a museum trip.");
    assert.equal(second.statusCode, 202, second.body);
    const b = second.json<{ intentVersionId: string; acceptedUnderstanding: string }>();
    assert.notEqual(b.intentVersionId, a.intentVersionId);
    assert.equal(b.acceptedUnderstanding, "Plan a simple weekend budget for a museum trip.");
  } finally {
    await app.close();
  }
});
