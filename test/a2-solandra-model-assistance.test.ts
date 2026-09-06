import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import { registerModelAssistanceApi } from "../src/model-assistance-api.js";
import { ModelAssistanceCapabilityService } from "../src/model-assistance-capability.js";
import { MemoryModelAssistanceAuthorizationStore } from "../src/model-assistance-store.js";
import type {
  KnowledgeSimplificationAttempt,
  KnowledgeSimplificationInput,
  KnowledgeSimplifier,
} from "../src/presentation/solandra/knowledge-simplification.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const ORIGINAL = "C4 photosynthesis spatially separates initial carbon fixation from the Calvin cycle, which may reduce photorespiration under hot, dry conditions.";
const SIMPLE = "In C4 photosynthesis, plants first capture carbon separately from the Calvin cycle. This may reduce photorespiration when conditions are hot and dry.";

class SourceProvider implements KnowledgeAcquisitionProvider {
  readonly kind = "a2-solandra-source";
  async acquire(_request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    return {
      sources: [{
        sourceId: "c4-source",
        canonicalUri: "https://knowledge.example/c4",
        title: "C4 source",
        publisher: "Knowledge Example",
        retrievedAt: "2026-09-06T21:30:00.000Z",
        publishedAt: null,
        contentType: "text/plain",
        content: ORIGINAL,
      }],
      claims: [{
        claimId: "c4-report",
        text: ORIGINAL,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: "c4-source", relation: "SUPPORTS", excerpt: ORIGINAL }],
      }],
    };
  }
}

class ProductDelegate implements KnowledgeSimplifier {
  calls = 0;
  fail = false;
  async simplifyWithAudit(_input: KnowledgeSimplificationInput): Promise<KnowledgeSimplificationAttempt> {
    this.calls += 1;
    if (this.fail) return Object.freeze({ status: "PROVIDER_FAILURE", text: null, errorCode: "unavailable" });
    return Object.freeze({
      status: "SIMPLIFIED",
      text: SIMPLE,
      invocationProvenance: {
        executionClass: "LIVE_DIRECT",
        routeMode: "PINNED",
        requestedProvider: "qualified-fixture",
        requestedModel: "qualified-fixture-model",
        actualProvider: "qualified-fixture",
        actualModel: "qualified-fixture-model",
        brokerIdentity: null,
        brokerVersion: null,
        upstreamRequestId: "a2-fixture-request",
        routeProvenance: "COMPLETE",
      },
    });
  }
  async simplify(input: KnowledgeSimplificationInput): Promise<string | null> {
    const result = await this.simplifyWithAudit(input);
    return result.status === "SIMPLIFIED" ? result.text : null;
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
} as NodeJS.ProcessEnv);
const subjectHeader = (subjectId: string) => ({ "x-test-subject": subjectId });

async function wait(app: FastifyInstance, runId: string, subjectId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}`, headers: subjectHeader(subjectId) });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Run did not complete.");
}

async function turn(app: FastifyInstance, conversationId: string, subjectId: string, message: string) {
  const accepted = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    headers: subjectHeader(subjectId),
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(accepted.statusCode, 202, accepted.body);
  const runId = accepted.json<{ runId: string }>().runId;
  await wait(app, runId, subjectId);
  const outcome = await app.inject({
    method: "GET",
    url: `/api/v1/runs/${runId}/outcome`,
    headers: subjectHeader(subjectId),
  });
  assert.equal(outcome.statusCode, 200, outcome.body);
  return { runId, body: outcome.json<{ outcome: { findings: Array<{ text: string }> }; presentation: { assistantMessage: string } }>() };
}

async function state(app: FastifyInstance, subjectId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/capabilities/model-assistance",
    headers: subjectHeader(subjectId),
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ capability: { status: string; lastInvocation: any } }>().capability;
}

test("Solandra journey connects, uses, proves route, disconnects, and fails closed", async () => {
  const delegate = new ProductDelegate();
  const service = new ModelAssistanceCapabilityService(new MemoryModelAssistanceAuthorizationStore(), delegate);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    knowledgeAcquisitionProvider: new SourceProvider(),
    modelAssistanceService: service,
    authenticatedSubjectResolver: (request: FastifyRequest) => ({
      subjectId: typeof request.headers["x-test-subject"] === "string" ? request.headers["x-test-subject"] : "subject-a",
    }),
  });
  registerModelAssistanceApi(app, service);

  try {
    const subjectId = "subject-a";
    assert.equal((await state(app, subjectId)).status, "DISCONNECTED");
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations", headers: subjectHeader(subjectId) });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    await turn(app, conversationId, subjectId, "Explain C4 photosynthesis.");
    const blocked = await turn(app, conversationId, subjectId, "Put that in plain language.");
    assert.match(blocked.body.presentation.assistantMessage, /Model assistance isn't connected/iu);
    assert.equal(delegate.calls, 0);

    const connected = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities/model-assistance/connect",
      headers: subjectHeader(subjectId),
    });
    assert.equal(connected.statusCode, 200, connected.body);
    assert.equal((await state(app, subjectId)).status, "CONNECTED");
    assert.equal((await state(app, "subject-b")).status, "DISCONNECTED");

    const simplified = await turn(app, conversationId, subjectId, "Put that in plain language.");
    assert.equal(delegate.calls, 1);
    assert.equal(simplified.body.outcome.findings[0]?.text, ORIGINAL);
    assert.match(simplified.body.presentation.assistantMessage, /plants first capture carbon separately/iu);
    const used = await state(app, subjectId);
    assert.equal(used.lastInvocation?.runId, simplified.runId);
    assert.equal(used.lastInvocation?.outcome, "SUCCEEDED");
    assert.equal(used.lastInvocation?.provenance?.actualProvider, "qualified-fixture");

    const disconnected = await app.inject({
      method: "DELETE",
      url: "/api/v1/capabilities/model-assistance/connect",
      headers: subjectHeader(subjectId),
    });
    assert.equal(disconnected.statusCode, 200, disconnected.body);
    assert.equal((await state(app, subjectId)).status, "DISCONNECTED");
    const revoked = await turn(app, conversationId, subjectId, "Put that in plain language.");
    assert.match(revoked.body.presentation.assistantMessage, /Model assistance isn't connected/iu);
    assert.equal(delegate.calls, 1);

    await app.inject({ method: "POST", url: "/api/v1/capabilities/model-assistance/connect", headers: subjectHeader(subjectId) });
    delegate.fail = true;
    const failed = await turn(app, conversationId, subjectId, "Put that in plain language.");
    assert.match(failed.body.presentation.assistantMessage, /Model assistance couldn't complete that request/iu);
    assert.equal(delegate.calls, 2);
    assert.equal((await state(app, subjectId)).lastInvocation?.outcome, "PROVIDER_FAILURE");
  } finally {
    await app.close();
    await service.close();
  }
});
