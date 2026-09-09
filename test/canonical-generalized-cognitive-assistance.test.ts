import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { registerCapabilityBrokerApi } from "../src/capabilities/api.js";
import { MemoryCapabilityAuthorizationStore } from "../src/capabilities/authorization-store.js";
import { CapabilityBroker } from "../src/capabilities/broker.js";
import type { CapabilityContract } from "../src/capabilities/contracts.js";
import {
  USER_AUTHORIZED_MODEL_CAPABILITY_ID,
  type UserModelInput,
  type UserModelOutput,
} from "../src/capabilities/user-model-capability.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
} from "../src/solandra/cognition.js";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "canonical-cognitive-fixture",
  requestedModel: "canonical-cognitive-fixture",
  actualProvider: "canonical-cognitive-fixture",
  actualModel: "canonical-cognitive-fixture",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "canonical-cognitive-fixture-request",
  routeProvenance: "COMPLETE",
});

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

class CognitiveAssistanceCognition implements SolandraCognitiveRuntime {
  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return {
      proposal: {
        objectiveRelation: input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: input.message,
        requestedHelp: "COGNITIVE_ASSISTANCE",
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
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

function fixtureCapability(options: { fail?: boolean } = {}) {
  let calls = 0;
  const capability: CapabilityContract<UserModelInput, UserModelOutput> = {
    id: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
    description: "fixture generalized cognitive assistance",
    authorizationRequirement: "EXPLICIT_SUBJECT_GRANT",
    effect: "COGNITIVE_ONLY",
    trustHandling: "NON_AUTHORITATIVE_PROPOSAL",
    inputContract: "bounded USER material",
    outputContract: "non-authoritative proposed work",
    async invoke() {
      calls += 1;
      if (options.fail) throw new Error("fixture provider failure");
      return {
        output: {
          authority: "NON_AUTHORITATIVE_PROPOSAL",
          factualTreatment: "REQUIRES_KNOWLEDGE_TRUST",
          text: "Three bounded ideas from cognitive assistance.",
        },
        provenance: { kind: "MODEL", source: "MODEL_RUNTIME", ...PROVENANCE },
      };
    },
  };
  return { capability, calls: () => calls };
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function continuity(app: FastifyInstance, conversationId: string) {
  const response = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{
    messages: unknown[];
    runs: unknown[];
    knowledge: unknown[];
    recommendations: unknown[];
    acceptedChoices: unknown[];
  }>();
}

test("canonical Solandra exposes generalized cognitive assistance separately and handles direct completion before run-backed work", async () => {
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  const fixture = fixtureCapability();
  broker.register(fixture.capability);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new CognitiveAssistanceCognition(),
  });
  registerCapabilityBrokerApi(app, broker);
  try {
    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200, root.body);
    assert.match(root.body, /Cognitive assistance · checking/u);
    assert.match(root.body, /\/api\/v1\/capabilities\/user-model/u);
    assert.match(root.body, /\/api\/v1\/capabilities\/user-model\/connect/u);
    assert.match(root.body, /\/api\/v1\/capabilities\/model-assistance/u);
    assert.match(root.body, /Generated responses are proposals only/u);
    assert.match(root.body, /Cognitive assistance is disconnected\. Connect it to use this request\./u);
    assert.match(root.body, /Cognitive assistance is unavailable in this Lattice setup\./u);
    assert.match(root.body, /Cognitive assistance couldn't complete that request\. Nothing was changed/u);

    const directIndex = root.body.indexOf('body.status === "COGNITIVE_ASSISTANCE_COMPLETED"');
    const guardIndex = root.body.indexOf('if (!body.runId) throw new Error("I couldn\'t establish the requested work safely.")');
    assert.ok(directIndex >= 0, "Canonical browser must recognize direct cognitive completion.");
    assert.ok(guardIndex > directIndex, "Direct cognitive completion must be handled before the runId guard.");
    assert.match(root.body, /appendSolandraTurn\(assistantMessage\)/u);
  } finally {
    await app.close();
    await broker.close();
  }
});

test("canonical cognitive assistance requires explicit connection, remains non-authoritative, revokes cleanly, and reconnects", async () => {
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  const fixture = fixtureCapability();
  broker.register(fixture.capability);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new CognitiveAssistanceCognition(),
  });
  registerCapabilityBrokerApi(app, broker);
  try {
    const initial = await app.inject({ method: "GET", url: "/api/v1/capabilities/user-model" });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().capability.status, "DISCONNECTED");
    assert.equal(initial.json().capability.authorized, false);

    const conversationId = await createConversation(app);
    const denied = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "canonical-cognitive-denied", message: "Brainstorm three labels for my own notes folder." },
    });
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(denied.json().error, "USER_MODEL_CAPABILITY_NOT_AUTHORIZED");
    assert.equal(fixture.calls(), 0);

    const connected = await app.inject({ method: "POST", url: "/api/v1/capabilities/user-model/connect" });
    assert.equal(connected.statusCode, 200, connected.body);
    assert.equal(connected.json().capability.status, "CONNECTED");
    assert.equal(connected.json().capability.authorized, true);

    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "canonical-cognitive-success", message: "Brainstorm three different labels for my own notes folder." },
    });
    assert.equal(completed.statusCode, 200, completed.body);
    const body = completed.json();
    assert.equal(body.status, "COGNITIVE_ASSISTANCE_COMPLETED");
    assert.equal(body.presentation.assistantMessage, "Three bounded ideas from cognitive assistance.");
    assert.equal(body.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.equal(body.capability.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.equal(body.capability.effect, "COGNITIVE_ONLY");
    assert.equal(body.runId, undefined);
    assert.equal(body.intentScopeId, undefined);
    assert.equal(body.intentVersionId, undefined);
    assert.equal(body.knowledge, undefined);
    assert.equal(body.recommendationReference, undefined);
    assert.equal(fixture.calls(), 1);

    const afterSuccess = await continuity(app, conversationId);
    assert.equal(afterSuccess.runs.length, 0);
    assert.equal(afterSuccess.knowledge.length, 0);
    assert.equal(afterSuccess.recommendations.length, 0);
    assert.equal(afterSuccess.acceptedChoices.length, 0);

    const disconnected = await app.inject({ method: "DELETE", url: "/api/v1/capabilities/user-model/connect" });
    assert.equal(disconnected.statusCode, 200, disconnected.body);
    assert.equal(disconnected.json().capability.status, "DISCONNECTED");
    assert.equal(disconnected.json().capability.authorized, false);

    const deniedAfterRevoke = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "canonical-cognitive-revoked", message: "Brainstorm another three labels for my own notes folder." },
    });
    assert.equal(deniedAfterRevoke.statusCode, 403, deniedAfterRevoke.body);
    assert.equal(deniedAfterRevoke.json().error, "USER_MODEL_CAPABILITY_NOT_AUTHORIZED");
    assert.equal(fixture.calls(), 1, "Revoked capability must not silently reach the provider.");

    const reconnected = await app.inject({ method: "POST", url: "/api/v1/capabilities/user-model/connect" });
    assert.equal(reconnected.statusCode, 200, reconnected.body);
    assert.equal(reconnected.json().capability.status, "CONNECTED");

    const afterReconnect = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "canonical-cognitive-reconnect", message: "Brainstorm a final three labels for my own notes folder." },
    });
    assert.equal(afterReconnect.statusCode, 200, afterReconnect.body);
    assert.equal(afterReconnect.json().status, "COGNITIVE_ASSISTANCE_COMPLETED");
    assert.equal(fixture.calls(), 2);
  } finally {
    await app.close();
    await broker.close();
  }
});

test("canonical cognitive assistance reports unavailable and provider failure without creating authoritative Product state", async () => {
  const unavailableBroker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  const unavailableApp = await createRuntimeApp(config, { memoryDispatchDelayMs: 1 });
  registerCapabilityBrokerApi(unavailableApp, unavailableBroker);
  try {
    const state = await unavailableApp.inject({ method: "GET", url: "/api/v1/capabilities/user-model" });
    assert.equal(state.statusCode, 200, state.body);
    assert.equal(state.json().capability.status, "UNAVAILABLE");
    assert.equal(state.json().capability.available, false);
    assert.equal(state.json().capability.authorized, false);

    const connect = await unavailableApp.inject({ method: "POST", url: "/api/v1/capabilities/user-model/connect" });
    assert.equal(connect.statusCode, 503, connect.body);
    assert.equal(connect.json().error, "USER_MODEL_CAPABILITY_UNAVAILABLE");
  } finally {
    await unavailableApp.close();
    await unavailableBroker.close();
  }

  const failingBroker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  const failingFixture = fixtureCapability({ fail: true });
  failingBroker.register(failingFixture.capability);
  const failingApp = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new CognitiveAssistanceCognition(),
  });
  registerCapabilityBrokerApi(failingApp, failingBroker);
  try {
    assert.equal((await failingApp.inject({ method: "POST", url: "/api/v1/capabilities/user-model/connect" })).statusCode, 200);
    const conversationId = await createConversation(failingApp);
    const failed = await failingApp.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "canonical-cognitive-failure", message: "Brainstorm three labels for my own notes folder." },
    });
    assert.equal(failed.statusCode, 422, failed.body);
    assert.equal(failed.json().error, "COGNITIVE_ASSISTANCE_FAILED");
    assert.equal(failingFixture.calls(), 1);

    const afterFailure = await continuity(failingApp, conversationId);
    assert.equal(afterFailure.runs.length, 0);
    assert.equal(afterFailure.knowledge.length, 0);
    assert.equal(afterFailure.recommendations.length, 0);
    assert.equal(afterFailure.acceptedChoices.length, 0);

    const state = await failingApp.inject({ method: "GET", url: "/api/v1/capabilities/user-model" });
    assert.equal(state.statusCode, 200, state.body);
    assert.equal(state.json().capability.lastInvocation.outcome, "CAPABILITY_FAILURE");
  } finally {
    await failingApp.close();
    await failingBroker.close();
  }
});
