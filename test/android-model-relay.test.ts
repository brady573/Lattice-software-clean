import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { buildCanonicalApp as buildApp } from "../src/http-app.js";
import { AndroidRelayModelProvider, ModelRuntime } from "../src/model/index.js";
import { registerAndroidModelPrototype } from "../src/prototype/android-model-prototype.js";

const TOKEN = "prototype-token-0123456789-abcdef";

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function claimJob(app: FastifyInstance) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/prototype/android-model-relay/jobs/next",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (response.statusCode === 200) return response;
    assert.equal(response.statusCode, 204, response.body);
    await nextTurn();
  }
  assert.fail("Android relay job was not queued.");
}

test("Android relay provider dispatches non-thinking OpenAI-compatible jobs and normalizes responses", async () => {
  const provider = new AndroidRelayModelProvider({ timeoutMs: 2_000 });
  const runtime = new ModelRuntime(provider, { timeoutMs: 2_500 });
  const pending = runtime.call({
    model: "android-local-prototype",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0,
    maxOutputTokens: 64,
  }, {
    correlationId: "relay-provider-test",
  });

  await nextTurn();
  const job = provider.claimNext();
  assert.ok(job);
  assert.equal(job.correlationId, "relay-provider-test");
  assert.deepEqual(job.request, {
    model: "android-local-prototype",
    messages: [{ role: "user", content: "hello" }],
    chat_template_kwargs: { enable_thinking: false },
    temperature: 0,
    max_tokens: 64,
  });

  assert.equal(provider.complete(job.jobId, {
    statusCode: 200,
    bodyText: JSON.stringify({
      id: "local-1",
      model: "android-local-prototype",
      choices: [{ message: { role: "assistant", content: "LOCAL: hello" } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    }),
  }), "completed");

  const result = await pending;
  assert.equal(result.response.id, "local-1");
  assert.equal(result.response.model, "android-local-prototype");
  assert.deepEqual(result.response.output, [{ type: "text", text: "LOCAL: hello" }]);
  assert.deepEqual(result.response.usage, { inputTokens: 5, outputTokens: 3 });
  assert.equal(result.audit.providerKind, "android-relay-openai-compatible");
});

test("Android relay bounds pending jobs and releases capacity after failure", async () => {
  const provider = new AndroidRelayModelProvider({ timeoutMs: 2_000, maxPendingJobs: 1 });
  const runtime = new ModelRuntime(provider, { timeoutMs: 2_500 });
  const first = runtime.call({
    model: "android-local-prototype",
    messages: [{ role: "user", content: "first" }],
  }, { correlationId: "bounded-first" });

  await nextTurn();
  await assert.rejects(
    runtime.call({
      model: "android-local-prototype",
      messages: [{ role: "user", content: "second" }],
    }, { correlationId: "bounded-second" }),
    /bounded pending-job capacity/,
  );

  const claimed = provider.claimNext();
  assert.ok(claimed);
  assert.equal(provider.fail(claimed.jobId), "failed");
  await assert.rejects(first, /local inference endpoint/);
  assert.deepEqual(provider.status(), { queued: 0, claimed: 0 });
});

test("Android relay is isolated from the locked presentation surface and requires authentication", async () => {
  const provider = new AndroidRelayModelProvider({ timeoutMs: 2_000 });
  const runtime = new ModelRuntime(provider, { timeoutMs: 2_500 });
  const app = buildApp();
  registerAndroidModelPrototype(app, {
    provider,
    runtime,
    modelName: "android-local-prototype",
    relayToken: TOKEN,
  });

  try {
    const canonicalPage = await app.inject({ method: "GET", url: "/" });
    assert.equal(canonicalPage.statusCode, 200);
    assert.match(canonicalPage.body, /What do you need to figure out\?/);
    assert.match(canonicalPage.body, /id="conversation"/);
    assert.match(canonicalPage.body, /id="conversationInput"/);
    assert.match(canonicalPage.body, /id="composer"/);
    assert.doesNotMatch(canonicalPage.body, /\/api\/v1\/prototype\/model-conversations\//);
    assert.doesNotMatch(canonicalPage.body, /\/api\/v1\/prototype\/android-model-conversations\//);

    const page = await app.inject({ method: "GET", url: "/android-llm" });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /What do you need to figure out\?/);
    assert.match(page.body, /id="resourceFocus"/);
    assert.match(page.body, /id="newUpdate"/);
    assert.match(page.body, /support-node/);
    assert.doesNotMatch(page.body, /Android-hosted local model/);
    assert.doesNotMatch(page.body, /\/api\/v1\/prototype\/android-model-conversations\//);
    assert.doesNotMatch(page.body, /Knowledge Orbit|\borbit\b|\bplanet\b/i);

    const conversation = app.inject({
      method: "POST",
      url: "/api/v1/prototype/android-model-conversations/conversation-android/messages",
      payload: {
        turnId: "turn-android-1",
        messages: [{ role: "user", content: "Hello from Render." }],
      },
    });

    await nextTurn();
    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/v1/prototype/android-model-relay/jobs/next",
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error, "ANDROID_MODEL_RELAY_UNAUTHORIZED");

    const claimed = await claimJob(app);
    const job = claimed.json();
    assert.equal(typeof job.jobId, "string");
    assert.equal(job.correlationId, "android-prototype-conversation:conversation-android");
    assert.deepEqual(job.request.chat_template_kwargs, { enable_thinking: false });

    const completed = await app.inject({
      method: "POST",
      url: `/api/v1/prototype/android-model-relay/jobs/${encodeURIComponent(job.jobId)}/complete`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        statusCode: 200,
        bodyText: JSON.stringify({
          id: "android-1",
          model: "android-local-prototype",
          choices: [{ message: { role: "assistant", content: "Local Android response" } }],
        }),
      },
    });
    assert.equal(completed.statusCode, 204, completed.body);

    const response = await conversation;
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {
      conversationId: "conversation-android",
      turnId: "turn-android-1",
      prototype: true,
      authoritative: false,
      modelSource: "android-local",
      message: {
        role: "assistant",
        content: "Local Android response",
      },
    });
    assert.doesNotMatch(response.body, new RegExp(TOKEN));
  } finally {
    await app.close();
  }
});
