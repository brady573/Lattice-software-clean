import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import type { RuntimeConfig } from "../src/runtime-config.js";

const config: RuntimeConfig = {
  port: 3000,
  host: "127.0.0.1",
  databaseUrl: undefined,
  deploymentMode: "development",
  truthMode: "v36-offline",
  autoMigrate: false,
  modelSimulatorBaseUrl: undefined,
  modelSimulatorModel: "offline-prototype",
  androidModelRelayToken: undefined,
  androidModelRelayModel: "android-local-prototype",
  androidModelRelayTimeoutMs: 45_000,
};

const clearContent = "I need a laptop under $1,300 with at least 12 hours of battery life as a hard requirement. Performance matters more.";

function subjectHeaders(subjectId: string): Record<string, string> {
  return { "x-test-subject": subjectId };
}

async function createTwoSubjectApp() {
  return createRuntimeApp(config, {
    memoryDispatchDelayMs: 2_000,
    authenticatedSubjectResolver: (request) => {
      const value = request.headers["x-test-subject"];
      return typeof value === "string" ? { subjectId: value } : undefined;
    },
  });
}

test("M8-C isolates Conversation-derived messages, intent writes, Runs, plans, progress, results, and continuity", async () => {
  const app = await createTwoSubjectApp();
  try {
    const ownerHeaders = subjectHeaders("subject-a");
    const otherHeaders = subjectHeaders("subject-b");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/conversations",
      headers: ownerHeaders,
    });
    assert.equal(created.statusCode, 201);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      headers: ownerHeaders,
      payload: {
        turnId: "turn-m8-c-1",
        message: clearContent,
      },
    });
    assert.equal(accepted.statusCode, 202);
    const binding = accepted.json<{
      runId: string;
      intentScopeId: string;
      intentVersionId: string;
    }>();
    assert.ok(binding.runId);

    const ownerMessages = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: ownerHeaders,
    });
    assert.equal(ownerMessages.statusCode, 200);
    assert.equal(ownerMessages.json().messages.length, 1);

    const ownerContinuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
      headers: ownerHeaders,
    });
    assert.equal(ownerContinuity.statusCode, 200);
    assert.equal(ownerContinuity.json().runs[0].runId, binding.runId);

    const ownerRun = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${binding.runId}`,
      headers: ownerHeaders,
    });
    assert.equal(ownerRun.statusCode, 200);

    const ownerEvents = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${binding.runId}/events`,
      headers: ownerHeaders,
    });
    assert.equal(ownerEvents.statusCode, 200);

    const ownerPlan = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${binding.runId}/decision-plan`,
      headers: ownerHeaders,
    });
    assert.equal(ownerPlan.statusCode, 404);
    assert.equal(ownerPlan.json().error, "DECISION_PLAN_NOT_FOUND");

    const ownerResult = await app.inject({
      method: "GET",
      url: `/api/v1/runs/${binding.runId}/result`,
      headers: ownerHeaders,
    });
    assert.equal(ownerResult.statusCode, 409);
    assert.equal(ownerResult.json().error, "RUN_NOT_COMPLETED");

    const missingConversationId = randomUUID();
    for (const url of [
      `/api/v1/conversations/${conversationId}/messages`,
      `/api/v1/conversations/${conversationId}/continuity`,
    ]) {
      const crossUser = await app.inject({ method: "GET", url, headers: otherHeaders });
      const missing = await app.inject({
        method: "GET",
        url: url.replace(conversationId, missingConversationId),
        headers: otherHeaders,
      });
      assert.equal(crossUser.statusCode, 404);
      assert.deepEqual(crossUser.json(), { error: "CONVERSATION_NOT_FOUND" });
      assert.deepEqual(crossUser.json(), missing.json());
    }

    const crossIntentWrite = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      headers: otherHeaders,
      payload: {
        turnId: "turn-m8-c-cross",
        message: clearContent,
      },
    });
    assert.equal(crossIntentWrite.statusCode, 404);
    assert.deepEqual(crossIntentWrite.json(), { error: "CONVERSATION_NOT_FOUND" });

    const crossRunCreation = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: otherHeaders,
      payload: {},
    });
    assert.equal(crossRunCreation.statusCode, 404);
    assert.deepEqual(crossRunCreation.json(), { error: "CONVERSATION_NOT_FOUND" });

    const crossExactRunCreation = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/intent-scopes/${binding.intentScopeId}/versions/${binding.intentVersionId}/runs`,
      headers: otherHeaders,
      payload: {},
    });
    assert.equal(crossExactRunCreation.statusCode, 404);
    assert.deepEqual(crossExactRunCreation.json(), { error: "CONVERSATION_NOT_FOUND" });

    const ownerHistoryAfterRejectedWrites = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: ownerHeaders,
    });
    assert.equal(ownerHistoryAfterRejectedWrites.statusCode, 200);
    assert.equal(ownerHistoryAfterRejectedWrites.json().messages.length, 1);

    const missingRunId = randomUUID();
    const runReadCases = [
      { method: "GET" as const, suffix: "", error: "RUN_NOT_FOUND" },
      { method: "GET" as const, suffix: "/events", error: "RUN_NOT_FOUND" },
      { method: "GET" as const, suffix: "/events/stream", error: "RUN_NOT_FOUND" },
      { method: "GET" as const, suffix: "/result", error: "RUN_NOT_FOUND" },
      { method: "POST" as const, suffix: "/cancel", error: "RUN_NOT_FOUND" },
      { method: "GET" as const, suffix: "/decision-plan", error: "DECISION_PLAN_NOT_FOUND" },
    ];

    for (const testCase of runReadCases) {
      const crossUser = await app.inject({
        method: testCase.method,
        url: `/api/v1/runs/${binding.runId}${testCase.suffix}`,
        headers: otherHeaders,
      });
      const missing = await app.inject({
        method: testCase.method,
        url: `/api/v1/runs/${missingRunId}${testCase.suffix}`,
        headers: otherHeaders,
      });
      assert.equal(crossUser.statusCode, 404);
      assert.deepEqual(crossUser.json(), { error: testCase.error });
      assert.deepEqual(crossUser.json(), missing.json());
    }
  } finally {
    await app.close();
  }
});
