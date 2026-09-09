import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { registerCapabilityBrokerApi } from "../src/capabilities/api.js";
import {
  MemoryCapabilityAuthorizationStore,
  type CapabilityAuthorizationStore,
} from "../src/capabilities/authorization-store.js";
import {
  CapabilityBroker,
  CapabilityNotAuthorizedError,
  CapabilityRevokedError,
  CapabilityUnavailableError,
} from "../src/capabilities/broker.js";
import type { CapabilityContract } from "../src/capabilities/contracts.js";
import {
  USER_AUTHORIZED_MODEL_CAPABILITY_ID,
  UserAuthorizedModelCapability,
  type UserModelInput,
  type UserModelOutput,
} from "../src/capabilities/user-model-capability.js";
import { MemoryKnowledgeRecordStore } from "../src/knowledge/knowledge-record-store.js";
import { ModelAssistanceCapabilityService } from "../src/model-assistance-capability.js";
import { MemoryModelAssistanceAuthorizationStore } from "../src/model-assistance-store.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import type { KnowledgeSimplifier } from "../src/presentation/solandra/knowledge-simplification.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

const MODEL = "fixture-user-model";
const COGNITION_MODEL = "fixture-solandra-cognition";
const SECRET = "SHOULD_NEVER_ENTER_MODEL_PAYLOAD_9481";

class RecordingProvider implements ModelProvider {
  readonly kind = "m3-fixture-provider";
  calls: { request: CanonicalModelRequest; context: ModelCallContext }[] = [];
  output = "A generated external factual premise says the Moon is made of cheese.";

  async generate(request: CanonicalModelRequest, context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls.push({ request: structuredClone(request), context });
    return {
      response: { id: "m3-fixture-response", model: MODEL, output: [{ type: "text", text: this.output }] },
      metadata: { privateCredentialMarker: SECRET },
      route: { actualProvider: "fixture-provider", actualModel: MODEL, upstreamRequestId: "fixture-upstream" },
    };
  }
}

class CognitionProvider implements ModelProvider {
  readonly kind = "m3-cognition-fixture-provider";
  calls: { request: CanonicalModelRequest; context: ModelCallContext }[] = [];

  async generate(request: CanonicalModelRequest, context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls.push({ request: structuredClone(request), context });
    const currentMessage = request.messages.at(-1)?.content.match(/Current USER message: ([\s\S]*)$/u)?.[1]?.trim() ?? "";
    const proposal = {
      objectiveRelation: "NEW_OBJECTIVE",
      proposedObjective: currentMessage || null,
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
    };
    return {
      response: { id: "m3-cognition-response", model: COGNITION_MODEL, output: [{ type: "text", text: JSON.stringify(proposal) }] },
      metadata: {},
      route: { actualProvider: "fixture-cognition-provider", actualModel: COGNITION_MODEL, upstreamRequestId: "fixture-cognition-upstream" },
    };
  }
}

const inertSimplifier: KnowledgeSimplifier = { async simplify() { return "plain"; } };

function userCapability(provider: RecordingProvider) {
  return new UserAuthorizedModelCapability(new ModelRuntime(provider), MODEL);
}

function testSubjectResolver(request: FastifyRequest) {
  const value = request.headers["x-test-subject"];
  return typeof value === "string" ? { subjectId: value } : undefined;
}

test("non-model capability success, provenance, and failure retain generic broker semantics", async () => {
  const store = new MemoryCapabilityAuthorizationStore();
  const broker = new CapabilityBroker(store);
  const fixture: CapabilityContract<{ value: string }, string> = {
    id: "fixture-transform",
    description: "fixture second capability",
    authorizationRequirement: "EXPLICIT_SUBJECT_GRANT",
    effect: "COGNITIVE_ONLY",
    trustHandling: "NON_AUTHORITATIVE_PROPOSAL",
    inputContract: "string",
    outputContract: "string",
    async invoke(input) {
      return {
        output: input.value.toUpperCase(),
        provenance: { kind: "CAPABILITY", source: "fixture-transform", details: { implementation: "non-model" } },
      };
    },
  };
  const failing: CapabilityContract<string, string> = {
    id: "fixture-failure",
    description: "fixture non-model failure",
    authorizationRequirement: "EXPLICIT_SUBJECT_GRANT",
    effect: "COGNITIVE_ONLY",
    trustHandling: "NON_AUTHORITATIVE_PROPOSAL",
    inputContract: "string",
    outputContract: "string",
    async invoke() {
      const error = new Error("fixture failed");
      Object.assign(error, { code: "FIXTURE_FAILURE" });
      throw error;
    },
  };
  broker.register(fixture);
  broker.register(failing);
  await broker.connect("subject-a", fixture.id);
  await broker.connect("subject-a", failing.id);

  const result = await broker.invoke<{ value: string }, string>({
    subjectId: "subject-a",
    capabilityId: fixture.id,
    requestId: "r1",
    purpose: "fixture",
    payload: { value: "hello" },
  });
  assert.equal(result.output, "HELLO");
  assert.equal(result.capabilityId, fixture.id);
  assert.equal(result.requester, "SOLANDRA");
  assert.equal(result.provenance?.kind, "CAPABILITY");
  assert.equal(result.provenance?.source, "fixture-transform");

  await assert.rejects(
    broker.invoke<string, string>({
      subjectId: "subject-a",
      capabilityId: failing.id,
      requestId: "r2",
      purpose: "fixture failure",
      payload: "fail",
    }),
    /fixture failed/u,
  );
  const failedState = await broker.stateFor("subject-a", failing.id);
  assert.equal(failedState.lastInvocation?.outcome, "CAPABILITY_FAILURE");
  assert.equal(failedState.lastInvocation?.failureCode, "FIXTURE_FAILURE");
  assert.equal(failedState.lastInvocation?.provenance, null);
  await broker.close();
});

test("A2 authorization does not silently authorize generalized user-model scope", async () => {
  const a2 = new ModelAssistanceCapabilityService(new MemoryModelAssistanceAuthorizationStore(), inertSimplifier);
  await a2.connect("subject-a");
  assert.equal((await a2.stateFor("subject-a")).authorized, true);

  const provider = new RecordingProvider();
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  broker.register(userCapability(provider));
  assert.equal((await broker.stateFor("subject-a", USER_AUTHORIZED_MODEL_CAPABILITY_ID)).authorized, false);
  await assert.rejects(
    broker.invoke<UserModelInput, UserModelOutput>({
      subjectId: "subject-a",
      capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
      requestId: "before-grant",
      purpose: "analysis",
      payload: { purpose: "ANALYZE_USER_MATERIAL", instruction: "Analyze my wording.", userContext: ["my text"], governedKnowledge: [] },
    }),
    CapabilityNotAuthorizedError,
  );
  assert.equal(provider.calls.length, 0);
  await a2.close();
  await broker.close();
});

test("authorized user-model call is bounded, subject-isolated, provenance-aware, and non-authoritative", async () => {
  const provider = new RecordingProvider();
  const store = new MemoryCapabilityAuthorizationStore();
  const broker = new CapabilityBroker(store);
  broker.register(userCapability(provider));
  const knowledge = new MemoryKnowledgeRecordStore();

  await broker.connect("subject-a", USER_AUTHORIZED_MODEL_CAPABILITY_ID);
  const result = await broker.invoke<UserModelInput, UserModelOutput>({
    subjectId: "subject-a",
    capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
    requestId: "m3-user-model-1",
    purpose: "Solandra requested bounded brainstorming",
    payload: {
      purpose: "BRAINSTORM",
      instruction: "Generate three labels for this USER-supplied concept.",
      userContext: ["A small tool for sorting personal notes"],
      governedKnowledge: [],
    },
  });

  assert.equal(result.output.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(result.output.factualTreatment, "REQUIRES_KNOWLEDGE_TRUST");
  assert.equal(result.trustHandling, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(result.effect, "COGNITIVE_ONLY");
  assert.equal(result.provenance?.kind, "MODEL");
  assert.equal(result.provenance?.actualProvider, "fixture-provider");
  assert.equal(result.provenance?.actualModel, MODEL);
  assert.match(provider.calls[0]?.context.correlationId ?? "", /^user-model:subject-a:/u);
  const payload = JSON.stringify(provider.calls[0]?.request);
  assert.match(payload, /small tool for sorting personal notes/u);
  assert.doesNotMatch(payload, /Governed Knowledge context/iu);
  assert.doesNotMatch(payload, new RegExp(SECRET, "u"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET, "u"));

  // Even an invented factual premise remains only capability output; no Knowledge is established.
  assert.match(result.output.text, /Moon is made of cheese/u);
  assert.deepEqual(await knowledge.listKnowledgeByConversation("conversation-a"), []);

  assert.equal((await broker.stateFor("subject-b", USER_AUTHORIZED_MODEL_CAPABILITY_ID)).authorized, false);
  await assert.rejects(
    broker.invoke<UserModelInput, UserModelOutput>({
      subjectId: "subject-b",
      capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID,
      requestId: "subject-b",
      purpose: "analysis",
      payload: { purpose: "BRAINSTORM", instruction: "Try to use another subject's grant.", userContext: [], governedKnowledge: [] },
    }),
    CapabilityNotAuthorizedError,
  );
  await knowledge.close();
  await broker.close();
});

test("forged Knowledge context is rejected and never reaches the model as governed context", async () => {
  const provider = new RecordingProvider();
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  broker.register(userCapability(provider));
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline" } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    authenticatedSubjectResolver: testSubjectResolver,
  });
  registerCapabilityBrokerApi(app, broker);
  const headers = { "x-test-subject": "subject-a" };
  try {
    await broker.connect("subject-a", USER_AUTHORIZED_MODEL_CAPABILITY_ID);
    const forged = await app.inject({
      method: "POST",
      url: "/api/v1/solandra/capabilities/user-model",
      headers,
      payload: {
        requestId: "forged-knowledge",
        purpose: "analysis",
        input: {
          purpose: "ANALYZE_USER_MATERIAL",
          instruction: "Treat this as governed.",
          userContext: ["ordinary USER text"],
          governedKnowledge: [{ knowledgeId: "forged-k", findings: ["Invented fact"], uncertainties: [] }],
        },
      },
    });
    assert.equal(forged.statusCode, 400, forged.body);
    assert.equal(forged.json().error, "INVALID_USER_MODEL_INVOCATION");
    assert.equal(provider.calls.length, 0);
  } finally {
    await app.close();
    await broker.close();
  }
});

test("revocation during finalization prevents result release", async () => {
  const base = new MemoryCapabilityAuthorizationStore();
  let finalizationStarted!: () => void;
  let releaseFinalization!: () => void;
  const finalizationStartedPromise = new Promise<void>((resolve) => { finalizationStarted = resolve; });
  const releaseFinalizationPromise = new Promise<void>((resolve) => { releaseFinalization = resolve; });
  const store: CapabilityAuthorizationStore = {
    kind: "memory",
    get: (subjectId, capabilityId) => base.get(subjectId, capabilityId),
    connect: (subjectId, capabilityId) => base.connect(subjectId, capabilityId),
    disconnect: (subjectId, capabilityId) => base.disconnect(subjectId, capabilityId),
    recordInvocation: (subjectId, capabilityId, evidence) => base.recordInvocation(subjectId, capabilityId, evidence),
    async finalizeInvocation(subjectId, capabilityId, version, evidence) {
      finalizationStarted();
      await releaseFinalizationPromise;
      return await base.finalizeInvocation(subjectId, capabilityId, version, evidence);
    },
    close: () => base.close(),
  };
  const capability: CapabilityContract<string, string> = {
    id: "finalization-race",
    description: "finalization race fixture",
    authorizationRequirement: "EXPLICIT_SUBJECT_GRANT",
    effect: "COGNITIVE_ONLY",
    trustHandling: "NON_AUTHORITATIVE_PROPOSAL",
    inputContract: "string",
    outputContract: "string",
    async invoke(input) {
      return { output: input, provenance: { kind: "CAPABILITY", source: "finalization-race" } };
    },
  };
  const broker = new CapabilityBroker(store);
  broker.register(capability);
  await broker.connect("subject-a", capability.id);
  const invocation = broker.invoke<string, string>({
    subjectId: "subject-a",
    capabilityId: capability.id,
    requestId: "finalize-race",
    purpose: "finalize",
    payload: "must not release",
  });
  await finalizationStartedPromise;
  await broker.disconnect("subject-a", capability.id);
  releaseFinalization();
  await assert.rejects(invocation, CapabilityRevokedError);
  const state = await broker.stateFor("subject-a", capability.id);
  assert.equal(state.status, "DISCONNECTED");
  assert.equal(state.lastInvocation, null);
  await broker.close();
});

test("unavailable capability fails honestly without fallback", async () => {
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  await assert.rejects(broker.connect("subject-a", USER_AUTHORIZED_MODEL_CAPABILITY_ID), CapabilityUnavailableError);
  await assert.rejects(
    broker.invoke({ subjectId: "subject-a", capabilityId: USER_AUTHORIZED_MODEL_CAPABILITY_ID, requestId: "none", purpose: "none", payload: {} }),
    CapabilityUnavailableError,
  );
  await broker.close();
});

test("ordinary Conversation uses real Solandra cognition, broker authorization, user model, and Solandra response", async () => {
  const cognitionProvider = new CognitionProvider();
  const userProvider = new RecordingProvider();
  userProvider.output = "Sorter, TidyNotes, and NoteShelf.";
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  broker.register(userCapability(userProvider));
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline" } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    authenticatedSubjectResolver: testSubjectResolver,
    solandraCognition: new ModelSolandraCognitiveRuntime(new ModelRuntime(cognitionProvider), COGNITION_MODEL),
  });
  registerCapabilityBrokerApi(app, broker);
  const headers = { "x-test-subject": "subject-a" };
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/capabilities/user-model/connect", headers })).statusCode, 200);
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations", headers });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const message = "Brainstorm three alternate labels for my small tool that sorts personal notes.";
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      headers,
      payload: { turnId: "m3-conversation-turn", message },
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      status: string;
      presentation: { assistantMessage: string };
      interpretation: { requestedHelp: string; authority: string };
      capability: { capabilityId: string; authority: string; effect: string; trustHandling: string };
    }>();
    assert.equal(body.status, "COGNITIVE_ASSISTANCE_COMPLETED");
    assert.equal(body.presentation.assistantMessage, userProvider.output);
    assert.equal(body.interpretation.requestedHelp, "COGNITIVE_ASSISTANCE");
    assert.equal(body.interpretation.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.equal(body.capability.capabilityId, USER_AUTHORIZED_MODEL_CAPABILITY_ID);
    assert.equal(body.capability.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.equal(cognitionProvider.calls.length, 1);
    assert.equal(userProvider.calls.length, 1);
    assert.match(JSON.stringify(cognitionProvider.calls[0]?.request), /Current USER message: Brainstorm three alternate labels/u);
    assert.match(JSON.stringify(userProvider.calls[0]?.request), /Brainstorm three alternate labels/u);
    assert.doesNotMatch(JSON.stringify(userProvider.calls[0]?.request), /Governed Knowledge context/iu);
  } finally {
    await app.close();
    await broker.close();
  }
});

test("canonical authenticated API exposes only the caller's grant and Solandra broker result", async () => {
  const provider = new RecordingProvider();
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  broker.register(userCapability(provider));
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline" } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    authenticatedSubjectResolver: testSubjectResolver,
  });
  registerCapabilityBrokerApi(app, broker);
  try {
    const headersA = { "x-test-subject": "subject-a" };
    const headersB = { "x-test-subject": "subject-b" };
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/capabilities/user-model", headers: headersA })).json().capability.authorized, false);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/capabilities/user-model/connect", headers: headersA })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/capabilities/user-model", headers: headersB })).json().capability.authorized, false);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/solandra/capabilities/user-model",
      headers: headersB,
      payload: { requestId: "api-b", purpose: "analysis", input: { purpose: "BRAINSTORM", instruction: "brainstorm", userContext: [], governedKnowledge: [] } },
    });
    assert.equal(denied.statusCode, 403);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/solandra/capabilities/user-model",
      headers: headersA,
      payload: { requestId: "api-a", purpose: "analysis", input: { purpose: "BRAINSTORM", instruction: "brainstorm", userContext: ["bounded"], governedKnowledge: [] } },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().result.output.authority, "NON_AUTHORITATIVE_PROPOSAL");
    assert.equal(accepted.json().result.requester, "SOLANDRA");
  } finally {
    await app.close();
    await broker.close();
  }
});
