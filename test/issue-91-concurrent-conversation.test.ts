import assert from "node:assert/strict";
import test from "node:test";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

class SingleFlightConversationProvider implements ModelProvider {
  readonly kind = "issue-91-single-flight";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      response: {
        id: `issue-91-single-flight-${this.calls}`,
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({ mode: "CONVERSATION", response: "One stable conversational response." }),
        }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `issue-91-single-flight-request-${this.calls}`,
      },
    };
  }
}

function memoryConfig() {
  return resolveRuntimeConfig({
    NODE_ENV: "test",
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTHENTICATION_MODE: "development-fixture",
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-91-concurrent-user",
  });
}

test("Issue #91 concurrent duplicate conversational delivery shares one model call and one persisted response", async () => {
  const provider = new SingleFlightConversationProvider();
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "issue-91-single-flight-model");
  const app = await createRuntimeApp(memoryConfig(), { solandraCognition: cognition, memoryDispatchDelayMs: 1 });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201);
    const conversationId = created.json().conversation.id as string;
    const request = {
      method: "POST" as const,
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "duplicate-turn", message: "Give this idea a short playful label." },
    };

    const [left, right] = await Promise.all([app.inject(request), app.inject(request)]);
    assert.equal(left.statusCode, 200);
    assert.equal(right.statusCode, 200);
    const leftBody = left.json();
    const rightBody = right.json();
    assert.equal(leftBody.status, "CONVERSATION_COMPLETED");
    assert.equal(rightBody.status, "CONVERSATION_COMPLETED");
    assert.equal(leftBody.presentation.conversationText, "One stable conversational response.");
    assert.equal(rightBody.presentation.conversationText, leftBody.presentation.conversationText);
    assert.equal(rightBody.conversationResponse.responseId, leftBody.conversationResponse.responseId);
    assert.equal(provider.calls, 1, "ModelRuntime must single-flight an exact duplicate turn");

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200);
    const body = continuity.json();
    assert.deepEqual(body.messages.map((message: { role: string }) => message.role), ["USER", "SOLANDRA"]);
    assert.equal(body.messages[1].authority, "NON_AUTHORITATIVE_CONVERSATION");
    assert.equal(body.messages[1].factualAuthority, false);
  } finally {
    await app.close();
  }
});