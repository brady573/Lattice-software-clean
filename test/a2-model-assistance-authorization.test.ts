import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyRequest } from "fastify";
import { registerModelAssistanceApi } from "../src/model-assistance-api.js";
import { ModelAssistanceCapabilityService } from "../src/model-assistance-capability.js";
import { MemoryModelAssistanceAuthorizationStore } from "../src/model-assistance-store.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import type {
  KnowledgeSimplificationAttempt,
  KnowledgeSimplificationInput,
  KnowledgeSimplifier,
} from "../src/presentation/solandra/knowledge-simplification.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { renderSolandraAuthoritativeConversationPage } from "../src/ui/solandra-authoritative-conversation-page.js";

const ORIGINAL = "C4 photosynthesis may reduce photorespiration under hot, dry conditions.";
const SIMPLIFIED = "C4 photosynthesis may reduce photorespiration when conditions are hot and dry.";
const PRIVATE_MARKER = "PRIVATE_FIXTURE_MARKER_9217";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LIVE_DIRECT",
  routeMode: "PINNED",
  requestedProvider: "fixture-service",
  requestedModel: "fixture-capability",
  actualProvider: "fixture-service",
  actualModel: "fixture-capability",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "fixture-request-1",
  routeProvenance: "COMPLETE",
});

class RecordingSimplifier implements KnowledgeSimplifier {
  calls = 0;
  fail = false;
  readonly privateMarker = PRIVATE_MARKER;

  async simplifyWithAudit(_input: KnowledgeSimplificationInput): Promise<KnowledgeSimplificationAttempt> {
    this.calls += 1;
    return this.fail
      ? Object.freeze({ status: "PROVIDER_FAILURE", text: null, errorCode: "unavailable" })
      : Object.freeze({ status: "SIMPLIFIED", text: SIMPLIFIED, invocationProvenance: PROVENANCE });
  }

  async simplify(input: KnowledgeSimplificationInput): Promise<string | null> {
    const attempt = await this.simplifyWithAudit(input);
    return attempt.status === "SIMPLIFIED" ? attempt.text : null;
  }
}

const finding = {
  claimId: "claim-a2",
  text: ORIGINAL,
  status: "UNRESOLVED" as const,
  confidence: "LOW" as const,
  evidenceIds: ["evidence-a2"],
  contradictoryEvidenceIds: [],
  temporalQualifiers: { effectiveAt: null, period: null },
  basis: "SOURCE_REPORT" as const,
};

test("subject authorization gates use, records route evidence, and revocation prevents later use", async () => {
  const delegate = new RecordingSimplifier();
  const service = new ModelAssistanceCapabilityService(
    new MemoryModelAssistanceAuthorizationStore(),
    delegate,
  );
  const subjectA = service.simplifierFor("subject-a");

  assert.equal((await service.stateFor("subject-a")).status, "DISCONNECTED");
  assert.equal((await subjectA.simplifyWithAudit!({ runId: "run-1", finding })).status, "CAPABILITY_NOT_AUTHORIZED");
  assert.equal(delegate.calls, 0);

  await service.connect("subject-a");
  const used = await subjectA.simplifyWithAudit!({ runId: "run-2", finding });
  assert.equal(used.status, "SIMPLIFIED");
  assert.equal(delegate.calls, 1);
  const connected = await service.stateFor("subject-a");
  assert.equal(connected.lastInvocation?.outcome, "SUCCEEDED");
  assert.equal(connected.lastInvocation?.provenance?.actualProvider, "fixture-service");
  assert.equal(connected.lastInvocation?.provenance?.actualModel, "fixture-capability");
  assert.doesNotMatch(JSON.stringify(connected), new RegExp(PRIVATE_MARKER, "u"));

  assert.equal((await service.stateFor("subject-b")).status, "DISCONNECTED");
  const subjectB = service.simplifierFor("subject-b");
  assert.equal((await subjectB.simplifyWithAudit!({ runId: "run-b", finding })).status, "CAPABILITY_NOT_AUTHORIZED");
  assert.equal(delegate.calls, 1);

  await service.disconnect("subject-a");
  assert.equal((await subjectA.simplifyWithAudit!({ runId: "run-3", finding })).status, "CAPABILITY_NOT_AUTHORIZED");
  assert.equal(delegate.calls, 1);
  await service.close();
});

test("provider failure is explicit and no alternative invocation is substituted", async () => {
  const delegate = new RecordingSimplifier();
  delegate.fail = true;
  const service = new ModelAssistanceCapabilityService(
    new MemoryModelAssistanceAuthorizationStore(),
    delegate,
  );
  await service.connect("subject-a");
  const result = await service.simplifierFor("subject-a").simplifyWithAudit!({ runId: "run-fail", finding });
  assert.equal(result.status, "PROVIDER_FAILURE");
  assert.equal(delegate.calls, 1);
  const state = await service.stateFor("subject-a");
  assert.equal(state.lastInvocation?.outcome, "PROVIDER_FAILURE");
  assert.equal(state.lastInvocation?.failureCode, "unavailable");
  assert.equal(state.lastInvocation?.provenance, null);
  await service.close();
});

test("revocation during an in-flight invocation suppresses the completed result", async () => {
  let release!: (value: KnowledgeSimplificationAttempt) => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const delegate: KnowledgeSimplifier = {
    async simplifyWithAudit() {
      started();
      return await new Promise<KnowledgeSimplificationAttempt>((resolve) => { release = resolve; });
    },
    async simplify(input) {
      const result = await this.simplifyWithAudit!(input);
      return result.status === "SIMPLIFIED" ? result.text : null;
    },
  };
  const service = new ModelAssistanceCapabilityService(
    new MemoryModelAssistanceAuthorizationStore(),
    delegate,
  );
  await service.connect("subject-a");
  const pending = service.simplifierFor("subject-a").simplifyWithAudit!({ runId: "run-race", finding });
  await startedPromise;
  await service.disconnect("subject-a");
  release(Object.freeze({ status: "SIMPLIFIED", text: SIMPLIFIED, invocationProvenance: PROVENANCE }));
  assert.equal((await pending).status, "CAPABILITY_REVOKED");
  assert.equal((await service.stateFor("subject-a")).lastInvocation?.outcome, "REVOKED");
  await service.close();
});

test("authenticated capability API is subject-bound and unavailable configuration fails visibly", async () => {
  const service = new ModelAssistanceCapabilityService(
    new MemoryModelAssistanceAuthorizationStore(),
    undefined,
  );
  const config = resolveRuntimeConfig({
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-live",
  } as NodeJS.ProcessEnv);
  const app = await createRuntimeApp(config, {
    modelAssistanceService: service,
    authenticatedSubjectResolver: (request: FastifyRequest) => ({
      subjectId: typeof request.headers["x-test-subject"] === "string"
        ? request.headers["x-test-subject"]
        : "subject-a",
    }),
  });
  registerModelAssistanceApi(app, service);
  try {
    const state = await app.inject({
      method: "GET",
      url: "/api/v1/capabilities/model-assistance",
      headers: { "x-test-subject": "subject-a" },
    });
    assert.equal(state.statusCode, 200, state.body);
    assert.equal(state.json<{ capability: { status: string } }>().capability.status, "UNAVAILABLE");

    const connect = await app.inject({
      method: "POST",
      url: "/api/v1/capabilities/model-assistance/connect",
      headers: { "x-test-subject": "subject-a" },
    });
    assert.equal(connect.statusCode, 503, connect.body);
    assert.equal(connect.json<{ error: string }>().error, "MODEL_ASSISTANCE_UNAVAILABLE");
  } finally {
    await app.close();
    await service.close();
  }
});

test("Solandra exposes capability permission without route-selection controls", () => {
  const html = renderSolandraAuthoritativeConversationPage();
  assert.match(html, /Model assistance/u);
  assert.match(html, /Connect plain-language assistance/u);
  assert.match(html, /does not let the model decide what you mean, establish truth, make decisions, or authorize actions/u);
  assert.doesNotMatch(html, /fixture-service|fixture-capability|PRIVATE_FIXTURE_MARKER_9217/u);
});
