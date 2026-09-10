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

const databaseUrl = process.env.DATABASE_URL;
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
    ...overrides,
  };
}

class TopicTransitionCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const message = input.message;
    let semantic = proposal({
      objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
      proposedObjective: input.currentObjective ? null : message,
    });

    if (
      message === "How should I prepare soil for new sod?"
      || message === "Help me choose a quiet mechanical keyboard for a shared office."
      || message === "Plan a simple two-day itinerary for Santa Fe."
    ) {
      semantic = proposal({ objectiveRelation: "NEW_OBJECTIVE", proposedObjective: message });
    } else if (message === "Why?" || message === "Explain that more simply." || message === "What are your sources?") {
      semantic = proposal({ objectiveRelation: "CONTINUE", proposedObjective: null });
    } else if (message === "Correction: I meant new sod in heavy clay soil, not sandy soil.") {
      semantic = proposal({ objectiveRelation: "CORRECTION", proposedObjective: message });
    } else if (message === "Should I use that approach for the other place?") {
      semantic = proposal({
        objectiveRelation: "CONTINUE",
        proposedObjective: null,
        materialAmbiguity: {
          question: "Do you mean continue the current soil question, or start a different task for the other place?",
          couldChangeObjective: true,
        },
      });
    }

    return { proposal: semantic, invocationProvenance: PROVENANCE };
  }
}

const memoryConfig = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

function postgresConfig(autoMigrate: boolean) {
  assert.ok(databaseUrl);
  return resolveRuntimeConfig({
    DATABASE_URL: databaseUrl,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: String(autoMigrate),
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "topic-transition-postgres-user",
  } as NodeJS.ProcessEnv);
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

async function runRequest(app: FastifyInstance, runId: string) {
  const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{
    request: {
      objective: string;
      sourceMessageId: string;
      intentVersionId: string;
      intentScopeId: string;
    };
  }>();
}

test("clear unrelated topic creates successor Intent and binds the Run to the new USER task", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(memoryConfig, { solandraCognition: cognition, memoryDispatchDelayMs: 1000 });
  try {
    const conversationId = await createConversation(app);
    const firstMessage = "Why does iron rust?";
    const first = await submit(app, conversationId, firstMessage);
    assert.equal(first.statusCode, 202, first.body);
    const firstBody = first.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(firstBody.acceptedUnderstanding, firstMessage);

    const secondMessage = "How should I prepare soil for new sod?";
    const second = await submit(app, conversationId, secondMessage);
    assert.equal(second.statusCode, 202, second.body);
    const secondBody = second.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(secondBody.acceptedUnderstanding, secondMessage);
    assert.notEqual(secondBody.intentVersionId, firstBody.intentVersionId);

    const run = await runRequest(app, secondBody.runId);
    assert.equal(run.request.objective, secondMessage);
    assert.equal(run.request.intentVersionId, secondBody.intentVersionId);

    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    const body = continuity.json<{
      messages: Array<{ id: string; content: string }>;
      runs: Array<{ runId: string; exactBinding: { intentVersionId: string } | null }>;
    }>();
    const source = body.messages.find((message) => message.content === secondMessage);
    assert.ok(source);
    assert.equal(run.request.sourceMessageId, source.id);
    assert.equal(body.runs.find((entry) => entry.runId === secondBody.runId)?.exactBinding?.intentVersionId, secondBody.intentVersionId);
  } finally {
    await app.close();
  }
});

test("same-topic follow-up preserves the current authoritative objective", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(memoryConfig, { solandraCognition: cognition, memoryDispatchDelayMs: 1000 });
  try {
    const conversationId = await createConversation(app);
    const objective = "Why does iron rust?";
    const first = await submit(app, conversationId, objective);
    const firstBody = first.json<{ intentVersionId: string }>();

    const followup = await submit(app, conversationId, "Why?");
    assert.equal(followup.statusCode, 202, followup.body);
    const body = followup.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.equal(body.intentVersionId, firstBody.intentVersionId);
    assert.equal(body.acceptedUnderstanding, objective);
    const run = await runRequest(app, body.runId);
    assert.equal(run.request.objective, objective);
  } finally {
    await app.close();
  }
});

test("explicit USER correction creates successor Intent without rewriting prior lineage", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(memoryConfig, { solandraCognition: cognition, memoryDispatchDelayMs: 1000 });
  try {
    const conversationId = await createConversation(app);
    const objective = "How should I prepare soil for new sod?";
    const first = await submit(app, conversationId, objective);
    const firstBody = first.json<{ intentVersionId: string }>();

    const correctionMessage = "Correction: I meant new sod in heavy clay soil, not sandy soil.";
    const correction = await submit(app, conversationId, correctionMessage);
    assert.equal(correction.statusCode, 202, correction.body);
    const body = correction.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.notEqual(body.intentVersionId, firstBody.intentVersionId);
    assert.equal(body.acceptedUnderstanding, correctionMessage);
    const run = await runRequest(app, body.runId);
    assert.equal(run.request.objective, correctionMessage);
  } finally {
    await app.close();
  }
});

test("material topic ambiguity asks the minimum clarification and does not start new work", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(memoryConfig, { solandraCognition: cognition, memoryDispatchDelayMs: 1000 });
  try {
    const conversationId = await createConversation(app);
    const objective = "How should I prepare soil for new sod?";
    const first = await submit(app, conversationId, objective);
    const firstBody = first.json<{ intentVersionId: string }>();

    const ambiguous = await submit(app, conversationId, "Should I use that approach for the other place?");
    assert.equal(ambiguous.statusCode, 202, ambiguous.body);
    const body = ambiguous.json<{ status: string; runId?: string; intentVersionId: string; acceptedUnderstanding: string; question: string }>();
    assert.equal(body.status, "NEEDS_CLARIFICATION");
    assert.equal(body.runId, undefined);
    assert.equal(body.intentVersionId, firstBody.intentVersionId);
    assert.equal(body.acceptedUnderstanding, objective);
    assert.match(body.question, /continue the current soil question, or start a different task/iu);
  } finally {
    await app.close();
  }
});

test("unrelated-domain transitions are not limited to one example shape", async () => {
  const cognition = new TopicTransitionCognition();
  const app = await createRuntimeApp(memoryConfig, { solandraCognition: cognition, memoryDispatchDelayMs: 1000 });
  try {
    const conversationId = await createConversation(app);
    const writing = await submit(app, conversationId, "Rewrite this paragraph so it is easier to scan.");
    assert.equal(writing.statusCode, 202, writing.body);
    const firstVersion = writing.json<{ intentVersionId: string }>().intentVersionId;

    const consumerDecision = "Help me choose a quiet mechanical keyboard for a shared office.";
    const second = await submit(app, conversationId, consumerDecision);
    assert.equal(second.statusCode, 202, second.body);
    const secondBody = second.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.notEqual(secondBody.intentVersionId, firstVersion);
    assert.equal(secondBody.acceptedUnderstanding, consumerDecision);
    assert.equal((await runRequest(app, secondBody.runId)).request.objective, consumerDecision);

    const planning = "Plan a simple two-day itinerary for Santa Fe.";
    const third = await submit(app, conversationId, planning);
    assert.equal(third.statusCode, 202, third.body);
    const thirdBody = third.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.notEqual(thirdBody.intentVersionId, secondBody.intentVersionId);
    assert.equal(thirdBody.acceptedUnderstanding, planning);
    assert.equal((await runRequest(app, thirdBody.runId)).request.objective, planning);
  } finally {
    await app.close();
  }
});

test("PostgreSQL reload does not make restored Intent sticky across a clear topic change", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const firstCognition = new TopicTransitionCognition();
  let firstApp: FastifyInstance | undefined;
  let secondApp: FastifyInstance | undefined;
  try {
    firstApp = await createRuntimeApp(postgresConfig(true), { solandraCognition: firstCognition });
    const conversationId = await createConversation(firstApp);
    const firstMessage = "Why do stars appear to twinkle?";
    const first = await submit(firstApp, conversationId, firstMessage);
    assert.equal(first.statusCode, 202, first.body);
    const firstBody = first.json<{ intentVersionId: string }>();
    await firstApp.close();
    firstApp = undefined;

    const secondCognition = new TopicTransitionCognition();
    secondApp = await createRuntimeApp(postgresConfig(false), { solandraCognition: secondCognition });
    const newObjective = "Plan a simple two-day itinerary for Santa Fe.";
    const second = await submit(secondApp, conversationId, newObjective);
    assert.equal(second.statusCode, 202, second.body);
    const body = second.json<{ runId: string; intentVersionId: string; acceptedUnderstanding: string }>();
    assert.notEqual(body.intentVersionId, firstBody.intentVersionId);
    assert.equal(body.acceptedUnderstanding, newObjective);
    const run = await runRequest(secondApp, body.runId);
    assert.equal(run.request.objective, newObjective);
    assert.equal(run.request.intentVersionId, body.intentVersionId);
    assert.equal(secondCognition.inputs[0]?.currentObjective, firstMessage);
  } finally {
    await secondApp?.close();
    await firstApp?.close();
  }
});
