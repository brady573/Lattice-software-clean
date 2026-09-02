import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import {
  ModelRuntime,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";
import type { ConsultationProjection } from "../src/presentation/solandra/index.js";

class EchoConversationProvider implements ModelProvider {
  readonly kind = "test-conversation";

  async generate(
    request: CanonicalModelRequest,
    _context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    const latest = [...request.messages].reverse().find((message) => message.role === "user");
    return {
      response: {
        id: "simulated-turn",
        model: request.model,
        output: [{ type: "text", text: `SIMULATED: ${latest?.content ?? ""}` }],
      },
      metadata: {
        internalProvider: "should-not-reach-browser",
        verified: true,
        confidence: 1,
        truthVerdict: "TRUE",
      },
    };
  }
}

function conversationRuntime(): ModelRuntime {
  return new ModelRuntime(new EchoConversationProvider());
}

test("offline root serves the locked Solandra baseline when no simulator is configured", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/html/);
    assert.match(response.body, />Solandra</);
    assert.match(response.body, /What do you need to figure out\?/);
    assert.match(response.body, /id="resourceFocus"/);
    assert.match(response.body, /id="newUpdate"/);
    assert.match(response.body, /support-node/);
    assert.doesNotMatch(response.body, /Knowledge Orbit/i);
    assert.doesNotMatch(response.body, /\borbit\b/i);
    assert.doesNotMatch(response.body, /\bplanet\b/i);
    assert.doesNotMatch(response.body, /\/api\/v1\/prototype\/model-conversations\//);
    assert.doesNotMatch(response.body, /Confidence 87%/);
    assert.doesNotMatch(response.body, /CandidateScoreGauge/);
  } finally {
    await app.close();
  }
});

test("configured simulator does not select a parallel Solandra presentation surface", async () => {
  const app = buildApp({ modelRuntime: conversationRuntime(), modelName: "simulation-v7" });
  try {
    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"] ?? "", /^text\/html/);
    assert.match(response.body, />Solandra</);
    assert.match(response.body, /What do you need to figure out\?/);
    assert.match(response.body, /id="resourceFocus"/);
    assert.match(response.body, /id="newUpdate"/);
    assert.match(response.body, /support-node/);
    assert.doesNotMatch(response.body, /Test a conversation without confusing simulation with truth/);
    assert.doesNotMatch(response.body, /\/api\/v1\/prototype\/model-conversations\//);
    assert.doesNotMatch(response.body, /Knowledge Orbit|\borbit\b|\bplanet\b/i);
  } finally {
    await app.close();
  }
});

test("simulated conversation endpoint is unavailable unless explicitly configured", async () => {
  const app = buildApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/prototype/model-conversations/test/messages",
      payload: {
        turnId: "turn-1",
        messages: [{ role: "user", content: "hello" }],
      },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "MODEL_SIMULATION_NOT_CONFIGURED");
  } finally {
    await app.close();
  }
});

test("simulated conversation round-trip stays explicitly non-authoritative", async () => {
  const app = buildApp({ modelRuntime: conversationRuntime(), modelName: "simulation-v7" });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/prototype/model-conversations/conversation-1/messages",
      payload: {
        turnId: "turn-1",
        messages: [{ role: "user", content: "Help me think through a device purchase." }],
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      conversationId: "conversation-1",
      turnId: "turn-1",
      simulated: true,
      message: {
        role: "assistant",
        content: "SIMULATED: Help me think through a device purchase.",
      },
    });
    assert.doesNotMatch(response.body, /providerKind|audit|verified|confidence|truthVerdict|decision/i);
  } finally {
    await app.close();
  }
});

test("simulated conversation requires a user message as the newest turn", async () => {
  const app = buildApp({ modelRuntime: conversationRuntime() });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/prototype/model-conversations/conversation-1/messages",
      payload: {
        turnId: "turn-2",
        messages: [{ role: "assistant", content: "not a valid newest turn" }],
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "INVALID_PROTOTYPE_CONVERSATION");
  } finally {
    await app.close();
  }
});

test("default consultation projects authoritative state without raw ranking scores", async () => {
  const app = buildApp();
  try {
    const removedRoute = await app.inject({
      method: "POST",
      url: "/api/v1/prototype/consultations/laptop",
      payload: {},
    });
    assert.equal(removedRoute.statusCode, 404);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/prototype/consultations/default",
      payload: {},
    });
    assert.equal(response.statusCode, 201, response.body);
    const projection = response.json() as ConsultationProjection;
    assert.equal(projection.status, "COMPLETED");
    assert.equal(projection.result.recommendation.candidateId, "nova-air");
    assert.equal(projection.result.recommendation.label, "Nova Air");
    assert.equal(projection.conversation.priorities[0]?.criterion, "performance");
    assert.equal(projection.conversation.priorities[0]?.rank, 1);

    const atlas = projection.result.alternatives.find((item) => item.candidateId === "atlas-pro");
    assert.ok(atlas);
    assert.equal(atlas.eligible, false);
    assert.equal(
      atlas.requirementEffects.find((item) => item.criterion === "price")?.status,
      "failed",
    );

    const serialized = JSON.stringify(projection);
    assert.doesNotMatch(serialized, /rawScore/);
    assert.doesNotMatch(serialized, /normalizedScore/);
    assert.ok(projection.evidenceTraces.length > 0);
    assert.ok(projection.evidenceTraces.every((trace) => trace.sources.length > 0));
  } finally {
    await app.close();
  }
});
