import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

class TransitionCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const message = input.message.trim();
    const lower = message.toLocaleLowerCase("en-US");

    if (!input.currentObjective) {
      return {
        proposal: proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: message }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (lower === "why?" || lower.includes("explain that more simply") || lower.includes("what are your sources")) {
      return {
        proposal: proposal({ objectiveRelation: "CONTINUE", proposedObjective: null }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (lower.startsWith("actually,")) {
      return {
        proposal: proposal({ objectiveRelation: "CORRECTION", proposedObjective: message }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (lower.includes("could mean either")) {
      return {
        proposal: proposal({
          objectiveRelation: "CONTINUE",
          proposedObjective: null,
          materialAmbiguity: {
            question: "Do you want to continue the current topic, or start the other task you mentioned?",
            couldChangeObjective: true,
          },
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: message }),
      invocationProvenance: PROVENANCE,
    };
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

async function submit(app: FastifyInstance, conversationId: string, message: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
}

async function runRequest(app: FastifyInstance, runId: string) {
  const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{
    request: {
      objective: string;
      sourceMessageId: string;
      intentScopeId: string;
      intentVersionId: string;
    };
    exactBinding?: { intentScopeId: string; intentVersionId: string };
  }>();
}

test("clear unrelated topic creates successor Intent and exact Run binding to the new USER task", async () => {
  const cognition = new TransitionCognition();
  const app = await createRuntimeApp(config, { solandraCognition: cognition, memoryDispatchDelayMs: 60_000 });
  try {
    const conversationId = await createConversation(app);
    const firstMessage = "Why does iron rust?";
    const first = await submit(app, conversationId, firstMessage);
    assert.equal(first.statusCode, 202, first.body);
    const a = first.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string; provenance: { messageId: string } }>();
    assert.equal(a.acceptedUnderstanding, firstMessage);

    const secondMessage = "How should I prepare soil for new sod?";
    const second = await submit(app, conversationId, secondMessage);
    assert.equal(second.statusCode, 202, second.body);
    const b = second.json<{
      runId: string;
      intentScopeId: string;
      intentVersionId: string;
      acceptedUnderstanding: string;
      provenance: { messageId: string };
      interpretation: { objectiveRelation: string };
    }>();
    assert.equal(b.interpretation.objectiveRelation, "NEW_OBJECTIVE");
    assert.equal(b.acceptedUnderstanding, secondMessage);
    assert.notEqual(b.intentVersionId, a.intentVersionId);

    const run = await runRequest(app, b.runId);
    assert.equal(run.request.objective, secondMessage);
    assert.equal(run.request.sourceMessageId, b.provenance.messageId);
    assert.equal(run.request.intentScopeId, b.intentScopeId);
    assert.equal(run.request.intentVersionId, b.intentVersionId);
    if (run.exactBinding) {
      assert.equal(run.exactBinding.intentScopeId, b.intentScopeId);
      assert.equal(run.exactBinding.intentVersionId, b.intentVersionId);
    }
  } finally {
    await app.close();
  }
});

test("same-topic follow-up preserves current objective and IntentVersion", async () => {
  const cognition = new TransitionCognition();
  const app = await createRuntimeApp(config, { solandraCognition: cognition, memoryDispatchDelayMs: 60_000 });
  try {
    const conversationId = await createConversation(app);
    const firstMessage = "Why do leaves change color in autumn?";
    const first = await submit(app, conversationId, firstMessage);
    const a = first.json<{ intentVersionId: string }>();

    const followUp = await submit(app, conversationId, "Why?");
    assert.equal(followUp.statusCode, 202, followUp.body);
    const b = followUp.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(b.intentVersionId, a.intentVersionId);
    assert.equal(b.acceptedUnderstanding, firstMessage);
    assert.equal((await runRequest(app, b.runId)).request.objective, firstMessage);
  } finally {
    await app.close();
  }
});

test("explicit correction creates successor Intent without rewriting historical objective", async () => {
  const cognition = new TransitionCognition();
  const app = await createRuntimeApp(config, { solandraCognition: cognition, memoryDispatchDelayMs: 60_000 });
  try {
    const conversationId = await createConversation(app);
    const firstMessage = "Help me compare compact cameras for hiking.";
    const first = await submit(app, conversationId, firstMessage);
    const a = first.json<{ runId: string; intentVersionId: string }>();

    const correctionMessage = "Actually, I mean compact cameras for low-light indoor photos.";
    const correction = await submit(app, conversationId, correctionMessage);
    assert.equal(correction.statusCode, 202, correction.body);
    const b = correction.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.notEqual(b.intentVersionId, a.intentVersionId);
    assert.equal(b.acceptedUnderstanding, correctionMessage);
    assert.equal((await runRequest(app, a.runId)).request.objective, firstMessage);
    assert.equal((await runRequest(app, b.runId)).request.objective, correctionMessage);
  } finally {
    await app.close();
  }
});

test("materially ambiguous topic relation asks the minimum clarification instead of guessing", async () => {
  const cognition = new TransitionCognition();
  const app = await createRuntimeApp(config, { solandraCognition: cognition, memoryDispatchDelayMs: 60_000 });
  try {
    const conversationId = await createConversation(app);
    const first = await submit(app, conversationId, "Help me understand my garden drainage problem.");
    const a = first.json<{ intentVersionId: string }>();

    const ambiguous = await submit(app, conversationId, "That could mean either the drainage issue or the patio plan I mentioned. Could you help with that?");
    assert.equal(ambiguous.statusCode, 202, ambiguous.body);
    const body = ambiguous.json<{ status: string; intentVersionId: string; acceptedUnderstanding: string; question: string }>();
    assert.equal(body.status, "NEEDS_CLARIFICATION");
    assert.equal(body.intentVersionId, a.intentVersionId);
    assert.equal(body.acceptedUnderstanding, "Help me understand my garden drainage problem.");
    assert.match(body.question, /continue the current topic|start the other task/iu);
  } finally {
    await app.close();
  }
});

test("unrelated-domain topic changes are generic rather than tied to one example domain", async () => {
  const cognition = new TransitionCognition();
  const app = await createRuntimeApp(config, { solandraCognition: cognition, memoryDispatchDelayMs: 60_000 });
  try {
    const firstConversation = await createConversation(app);
    await submit(app, firstConversation, "Explain why the Moon has phases.");
    const gardening = "Plan the steps for preparing a shady yard for fescue seed.";
    const firstSwitch = await submit(app, firstConversation, gardening);
    assert.equal(firstSwitch.statusCode, 202, firstSwitch.body);
    assert.equal(firstSwitch.json<{ acceptedUnderstanding: string }>().acceptedUnderstanding, gardening);

    const secondConversation = await createConversation(app);
    await submit(app, secondConversation, "Rewrite this paragraph so it sounds less formal.");
    const consumer = "Which kind of vacuum should I consider for a small apartment with a cat?";
    const secondSwitch = await submit(app, secondConversation, consumer);
    assert.equal(secondSwitch.statusCode, 202, secondSwitch.body);
    assert.equal(secondSwitch.json<{ acceptedUnderstanding: string }>().acceptedUnderstanding, consumer);
  } finally {
    await app.close();
  }
});
