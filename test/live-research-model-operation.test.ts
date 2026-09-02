import assert from "node:assert/strict";
import test from "node:test";
import type {
  CapabilityExecutor,
  CapabilityGrant,
  CapabilityStateGuard,
} from "../src/capability-execution-policy.js";
import type { ExternalContextProjectionInput } from "../src/model/context-projection.js";
import type { ModelRuntimeResult } from "../src/model/types.js";
import type { DurableResearchTask } from "../src/orchestration-store.js";
import type {
  LiveResearchOperationContext,
} from "../src/live-research-task-executor.js";
import {
  LiveResearchModelOperationError,
  PinnedLiveResearchModelOperation,
  type LiveResearchModelRuntime,
} from "../src/live-research-model-operation.js";

function task(): DurableResearchTask {
  return {
    id: "task-live-model",
    runId: "run-live-model",
    taskFingerprint: "fingerprint-live-model",
    planVersion: 2,
    taskType: "RESEARCH",
    input: {
      kind: "V36_RESEARCH_REQUEST",
      checkpointHash: "checkpoint-live-model",
      request: {
        id: "request-live-model",
        runId: "run-live-model",
        claimId: "claim-live-model",
        parentRequestId: null,
        purpose: "SUPPORT",
        query: "Verify the current bounded claim.",
        serialRound: 1,
      },
    },
    contextVersionIds: ["v36-checkpoint:checkpoint-live-model"],
    dependsOn: [],
    runEpoch: 7,
    status: "RUNNING",
    maxAttempts: 1,
    attemptCount: 1,
    currentAttempt: 1,
    leaseOwner: "worker-live-model",
    leaseExpiresAt: "2026-08-31T23:00:00.000Z",
    acceptedResult: null,
  };
}

function context(): LiveResearchOperationContext {
  return {
    task: task(),
    binding: {
      runId: "run-live-model",
      runEpoch: 7,
      runStatus: "INVESTIGATING",
      conversationId: "conversation-live-model",
      subjectId: "subject-live-model",
      intentScopeId: "scope-live-model",
      intentVersionId: "intent-live-model-v2",
    },
    checkpointHash: "checkpoint-live-model",
    request: {
      id: "request-live-model",
      runId: "run-live-model",
      claimId: "claim-live-model",
      parentRequestId: null,
      purpose: "SUPPORT",
      query: "Verify the current bounded claim.",
      serialRound: 1,
    },
  };
}

function projectionInput(overrides: Partial<ExternalContextProjectionInput> = {}): ExternalContextProjectionInput {
  return {
    subjectId: "subject-live-model",
    role: "RESEARCH",
    conversation: {
      conversationId: "conversation-live-model",
      ownerSubjectId: "subject-live-model",
      state: "ACTIVE",
    },
    currentUserTurn: {
      messageId: "message-live-model",
      conversationId: "conversation-live-model",
      content: "Historical-looking text that is not licensed into this projection.",
      intentScopeId: "scope-live-model",
      intentVersionId: "intent-live-model-v2",
    },
    intent: {
      ownerSubjectId: "subject-live-model",
      intentScopeId: "scope-live-model",
      intentVersionId: "intent-live-model-v2",
      values: { licensed: "value", unlicensed: "must-not-cross" },
    },
    run: {
      runId: "run-live-model",
      subjectId: "subject-live-model",
      intentScopeId: "scope-live-model",
      intentVersionId: "intent-live-model-v2",
      taskDescription: "Bounded V36 research",
    },
    research: {
      runId: "run-live-model",
      checkpointId: "checkpoint-live-model",
      queryMaterial: "Verify the current bounded claim.",
    },
    policy: {
      includeCurrentUserTurn: false,
      intentKeys: ["licensed"],
      includeResearchMaterial: true,
      maxBytes: 8 * 1024,
    },
    ...overrides,
  };
}

function grant(overrides: Partial<CapabilityGrant> = {}): CapabilityGrant {
  return {
    capabilityId: "research.lookup",
    capabilityVersion: "1",
    runId: "run-live-model",
    subjectId: "subject-live-model",
    intentVersionId: "intent-live-model-v2",
    role: "RESEARCH",
    tool: {
      name: "research_lookup",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    maxCalls: 1,
    timeoutMs: 1000,
    maxInputBytes: 4096,
    maxOutputBytes: 8192,
    egress: { kind: "ALLOWLIST", origins: ["https://example.test"] },
    idempotency: "IDEMPOTENT",
    ...overrides,
  };
}

function modelResult(output: ModelRuntimeResult["response"]["output"]): ModelRuntimeResult {
  return {
    response: {
      id: "provider-response-1",
      model: "live-model",
      output,
    },
    audit: {
      correlationId: "m9-5:task-live-model",
      requestIdentity: "request-identity",
      providerKind: "fixture-live-provider",
      attempt: 0,
      elapsedMs: 1,
      providerMetadata: {},
      invocationProvenance: {
        executionClass: "LIVE_DIRECT",
        routeMode: "PINNED",
        requestedProvider: "fixture-provider",
        requestedModel: "live-model",
        actualProvider: "fixture-provider",
        actualModel: "live-model",
        brokerIdentity: null,
        brokerVersion: null,
        upstreamRequestId: "provider-response-1",
        routeProvenance: "COMPLETE",
      },
    },
  };
}

function activeGuard(): CapabilityStateGuard {
  return { async check() { return "ACTIVE"; } };
}

test("M9-5 composes only the licensed M9-3 projection into one exact M9-2 capability proposal", async () => {
  let rawModelRequest: unknown;
  let modelOptions: unknown;
  const runtime: LiveResearchModelRuntime = {
    async call(request, options) {
      rawModelRequest = request;
      modelOptions = options;
      return modelResult([{
        type: "tool_call",
        id: "tool-call-1",
        name: "research_lookup",
        arguments: { query: "Verify the current bounded claim." },
      }]);
    },
  };
  let capabilityCalls = 0;
  const capabilityExecutor: CapabilityExecutor = {
    async execute(execution) {
      capabilityCalls += 1;
      assert.equal(execution.runId, "run-live-model");
      assert.equal(execution.subjectId, "subject-live-model");
      assert.equal(execution.intentVersionId, "intent-live-model-v2");
      assert.equal(execution.role, "RESEARCH");
      assert.deepEqual(execution.arguments, { query: "Verify the current bounded claim." });
      return { artifacts: [], edges: [], evidence: [] };
    },
  };

  const operation = new PinnedLiveResearchModelOperation(
    {
      model: "live-model",
      requestedProvider: "fixture-provider",
      executionClass: "LIVE_DIRECT",
    },
    runtime,
    { async load() { return projectionInput(); } },
    { async load() { return grant(); } },
    activeGuard(),
    capabilityExecutor,
  );

  const result = await operation.execute(context()) as Record<string, unknown>;
  assert.equal(capabilityCalls, 1);
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.evidence, []);
  assert.ok(result.operationalProvenance);

  const request = rawModelRequest as { messages?: Array<{ role?: string; content?: string }> };
  const userMessage = request.messages?.find((message) => message.role === "user");
  assert.ok(userMessage?.content);
  const projected = JSON.parse(userMessage.content) as {
    currentUserTurn?: unknown;
    intentValues?: Record<string, unknown>;
    research?: { queryMaterial?: string };
  };
  assert.deepEqual(projected.intentValues, { licensed: "value" });
  assert.equal(projected.currentUserTurn, undefined);
  assert.equal(projected.research?.queryMaterial, "Verify the current bounded claim.");
  const serializedProjection = JSON.stringify(projected);
  assert.doesNotMatch(serializedProjection, /must-not-cross/u);
  assert.doesNotMatch(serializedProjection, /Historical-looking/u);
  assert.match(JSON.stringify(modelOptions), /LIVE_DIRECT/u);
  assert.match(JSON.stringify(modelOptions), /PINNED/u);
  assert.match(JSON.stringify(modelOptions), /fixture-provider/u);
});

test("M9-5 rejects projection drift before invoking the model", async () => {
  let modelCalls = 0;
  const runtime: LiveResearchModelRuntime = {
    async call() {
      modelCalls += 1;
      return modelResult([]);
    },
  };
  const operation = new PinnedLiveResearchModelOperation(
    { model: "live-model", requestedProvider: "fixture-provider", executionClass: "LIVE_DIRECT" },
    runtime,
    {
      async load() {
        return projectionInput({
          research: {
            runId: "run-live-model",
            checkpointId: "different-checkpoint",
            queryMaterial: "Verify the current bounded claim.",
          },
        });
      },
    },
    { async load() { return grant(); } },
    activeGuard(),
    { async execute() { return { artifacts: [], edges: [], evidence: [] }; } },
  );

  await assert.rejects(operation.execute(context()), (error: unknown) => {
    assert.ok(error instanceof LiveResearchModelOperationError);
    assert.equal(error.code, "CONTEXT_BINDING_MISMATCH");
    return true;
  });
  assert.equal(modelCalls, 0);
});

test("M9-5 rejects a cross-subject capability grant before exposing it to the model", async () => {
  let modelCalls = 0;
  const operation = new PinnedLiveResearchModelOperation(
    { model: "live-model", requestedProvider: "fixture-provider", executionClass: "LIVE_DIRECT" },
    {
      async call() {
        modelCalls += 1;
        return modelResult([]);
      },
    },
    { async load() { return projectionInput(); } },
    { async load() { return grant({ subjectId: "different-subject" }); } },
    activeGuard(),
    { async execute() { return { artifacts: [], edges: [], evidence: [] }; } },
  );

  await assert.rejects(operation.execute(context()), (error: unknown) => {
    assert.ok(error instanceof LiveResearchModelOperationError);
    assert.equal(error.code, "CAPABILITY_BINDING_MISMATCH");
    return true;
  });
  assert.equal(modelCalls, 0);
});

test("M9-5 fails closed when the model emits prose, zero proposals, or multiple proposals", async () => {
  for (const output of [
    [{ type: "text" as const, text: "I think this is true." }],
    [],
    [
      { type: "tool_call" as const, id: "call-a", name: "research_lookup", arguments: { query: "a" } },
      { type: "tool_call" as const, id: "call-b", name: "research_lookup", arguments: { query: "b" } },
    ],
  ]) {
    let capabilityCalls = 0;
    const operation = new PinnedLiveResearchModelOperation(
      { model: "live-model", requestedProvider: "fixture-provider", executionClass: "LIVE_DIRECT" },
      { async call() { return modelResult(output); } },
      { async load() { return projectionInput(); } },
      { async load() { return grant(); } },
      activeGuard(),
      {
        async execute() {
          capabilityCalls += 1;
          return { artifacts: [], edges: [], evidence: [] };
        },
      },
    );

    await assert.rejects(operation.execute(context()), (error: unknown) => {
      assert.ok(error instanceof LiveResearchModelOperationError);
      assert.equal(error.code, "INVALID_MODEL_PROPOSAL");
      return true;
    });
    assert.equal(capabilityCalls, 0);
  }
});

test("M9-5 keeps capability reuse operational and attaches exact route provenance without V36 authority", async () => {
  let capabilityCalls = 0;
  const operation = new PinnedLiveResearchModelOperation(
    { model: "live-model", requestedProvider: "fixture-provider", executionClass: "LIVE_DIRECT" },
    {
      async call() {
        return modelResult([{
          type: "tool_call",
          id: "tool-call-replay",
          name: "research_lookup",
          arguments: { query: "Verify the current bounded claim." },
        }]);
      },
    },
    { async load() { return projectionInput(); } },
    { async load() { return grant(); } },
    activeGuard(),
    {
      async execute() {
        capabilityCalls += 1;
        return { duplicated: true };
      },
    },
    {
      async load(operationId) {
        return {
          operationId,
          state: "SUCCEEDED",
          result: { artifacts: [], edges: [], evidence: [] },
        };
      },
    },
  );

  const result = await operation.execute(context()) as Record<string, unknown>;
  assert.equal(capabilityCalls, 0);
  const provenance = result.operationalProvenance as Record<string, unknown>;
  const capability = provenance.capability as Record<string, unknown>;
  const invocation = provenance.modelInvocation as Record<string, unknown>;
  assert.equal(capability.reused, true);
  assert.equal(invocation.routeProvenance, "COMPLETE");
});
