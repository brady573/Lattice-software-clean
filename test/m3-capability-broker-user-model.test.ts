import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { registerCapabilityBrokerApi } from "../src/capabilities/api.js";
import { MemoryCapabilityAuthorizationStore } from "../src/capabilities/authorization-store.js";
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

const MODEL = "fixture-user-model";
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

const inertSimplifier: KnowledgeSimplifier = { async simplify() { return "plain"; } };

function userCapability(provider: RecordingProvider) {
  return new UserAuthorizedModelCapability(new ModelRuntime(provider), MODEL);
}

test("generic broker dispatch is not user-model-specific", async () => {
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
    async invoke(input) { return { output: input.value.toUpperCase(), provenance: null }; },
  };
  broker.register(fixture);
  await broker.connect("subject-a", fixture.id);
  const result = await broker.invoke({ subjectId: "subject-a", capabilityId: fixture.id, requestId: "r1", purpose: "fixture", payload: { value: "hello" } });
  assert.equal(result.output, "HELLO");
  assert.equal(result.capabilityId, fixture.id);
  assert.equal(result.requester, "SOLANDRA");
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
    broker.invoke({
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
  const result = await broker.invoke({
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
  assert.equal(result.provenance?.actualProvider, "fixture-provider");
  assert.equal(result.provenance?.actualModel, MODEL);
  assert.match(provider.calls[0]?.context.correlationId ?? "", /^user-model:subject-a:/u);
  const payload = JSON.stringify(provider.calls[0]?.request);
  assert.match(payload, /small tool for sorting personal notes/u);
  assert.doesNotMatch(payload, new RegExp(SECRET, "u"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET, "u"));

  // Even an invented factual premise remains only capability output; no Knowledge is established.
  assert.match(result.output.text, /Moon is made of cheese/u);
  assert.deepEqual(await knowledge.listKnowledgeByConversation("conversation-a"), []);

  assert.equal((await broker.stateFor("subject-b", USER_AUTHORIZED_MODEL_CAPABILITY_ID)).authorized, false);
  await assert.rejects(
    broker.invoke({
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

test("revocation during invocation discards the result", async () => {
  let started!: () => void;
  let release!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const delayed: CapabilityContract<string, string> = {
    id: "delayed-cognitive",
    description: "delayed fixture",
    authorizationRequirement: "EXPLICIT_SUBJECT_GRANT",
    effect: "COGNITIVE_ONLY",
    trustHandling: "NON_AUTHORITATIVE_PROPOSAL",
    inputContract: "string",
    outputContract: "string",
    async invoke(input) { started(); await releasePromise; return { output: input, provenance: null }; },
  };
  const store = new MemoryCapabilityAuthorizationStore();
  const broker = new CapabilityBroker(store);
  broker.register(delayed);
  await broker.connect("subject-a", delayed.id);
  const invocation = broker.invoke({ subjectId: "subject-a", capabilityId: delayed.id, requestId: "race", purpose: "race", payload: "discard me" });
  await startedPromise;
  await broker.disconnect("subject-a", delayed.id);
  release();
  await assert.rejects(invocation, CapabilityRevokedError);
  assert.equal((await broker.stateFor("subject-a", delayed.id)).lastInvocation?.outcome, "REVOKED");
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

test("canonical authenticated API exposes only the caller's grant and Solandra broker result", async () => {
  const provider = new RecordingProvider();
  const broker = new CapabilityBroker(new MemoryCapabilityAuthorizationStore());
  broker.register(userCapability(provider));
  const config = resolveRuntimeConfig({ LATTICE_DEPLOYMENT_MODE: "development", LATTICE_TRUTH_MODE: "v36-offline" } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    authenticatedSubjectResolver: (request: FastifyRequest) => {
      const value = request.headers["x-test-subject"];
      return typeof value === "string" ? { subjectId: value } : undefined;
    },
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
