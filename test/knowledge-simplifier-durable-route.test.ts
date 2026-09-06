import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredKnowledgeSimplifier } from "../src/knowledge-simplifier-composition.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL,
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../src/model/groq-knowledge-simplifier.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const API_KEY = "gsk_fixture_knowledge_simplifier_key_1234567890";

function durableEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    LATTICE_DEPLOYMENT_MODE: "durable",
    DATABASE_URL: "postgresql://example.invalid/lattice",
    ...overrides,
  };
}

function request() {
  return {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [
      { role: "system" as const, content: "Rewrite faithfully." },
      { role: "user" as const, content: "Original finding: A complex sentence." },
    ],
    temperature: 0,
    maxOutputTokens: 128,
    seed: 0,
  };
}

test("durable Knowledge simplification requires one explicit route and never activates from a provider key alone", () => {
  const inert = resolveRuntimeConfig(durableEnv({ GROQ_API_KEY: API_KEY }));
  assert.equal(inert.knowledgeSimplifierRoute, undefined);
  assert.equal(inert.knowledgeSimplifierApiKey, undefined);
  assert.equal(createConfiguredKnowledgeSimplifier(inert), undefined);

  const configured = resolveRuntimeConfig(durableEnv({
    LATTICE_KNOWLEDGE_SIMPLIFIER_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: API_KEY,
  }));
  assert.equal(configured.knowledgeSimplifierRoute, "groq-gpt-oss-120b");
  assert.equal(configured.knowledgeSimplifierApiKey, API_KEY);
  assert.ok(createConfiguredKnowledgeSimplifier(configured));
});

test("durable Knowledge simplification fails closed for incomplete, unknown, or ambiguous route configuration", () => {
  assert.throws(
    () => resolveRuntimeConfig(durableEnv({
      LATTICE_KNOWLEDGE_SIMPLIFIER_ROUTE: "groq-gpt-oss-120b",
    })),
    /requires GROQ_API_KEY/,
  );
  assert.throws(
    () => resolveRuntimeConfig(durableEnv({
      LATTICE_KNOWLEDGE_SIMPLIFIER_ROUTE: "automatic-provider",
      GROQ_API_KEY: API_KEY,
    })),
    /Unsupported LATTICE_KNOWLEDGE_SIMPLIFIER_ROUTE/,
  );
  assert.throws(
    () => resolveRuntimeConfig({
      LATTICE_LOCAL_MODEL_PROVIDER_BASE_URL: "http://127.0.0.1:11434/v1",
      LATTICE_KNOWLEDGE_SIMPLIFIER_ROUTE: "groq-gpt-oss-120b",
      GROQ_API_KEY: API_KEY,
    }),
    /not both/,
  );
});

test("Groq simplifier route is pinned text-only and produces COMPLETE LIVE_DIRECT provenance", async () => {
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: API_KEY,
    fetchImpl: async (input, init) => {
      observedUrl = String(input);
      observedInit = init;
      return new Response(JSON.stringify({
        id: "chatcmpl-simplify-1",
        model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
        choices: [{
          message: {
            role: "assistant",
            content: "A simpler sentence with the same meaning.",
          },
        }],
      }), { status: 200 });
    },
  });
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider, 5_000);
  const result = await runtime.call(request(), {
    correlationId: "knowledge-simplifier-route-test",
    maxAttempts: 1,
  });

  assert.equal(observedUrl, `${GROQ_KNOWLEDGE_SIMPLIFIER_BASE_URL}/chat/completions`);
  assert.equal(observedInit?.method, "POST");
  assert.equal(observedInit?.redirect, "error");
  assert.equal((observedInit?.headers as Record<string, string>).authorization, `Bearer ${API_KEY}`);
  const sent = JSON.parse(String(observedInit?.body)) as Record<string, unknown>;
  assert.equal(sent.model, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  assert.equal(sent.reasoning_effort, "low");
  assert.equal(sent.max_completion_tokens, 128);
  assert.equal("tools" in sent, false);
  assert.equal("tool_choice" in sent, false);

  assert.equal(result.response.output.length, 1);
  assert.deepEqual(result.response.output[0], {
    type: "text",
    text: "A simpler sentence with the same meaning.",
  });
  assert.deepEqual(result.audit.invocationProvenance, {
    executionClass: "LIVE_DIRECT",
    routeMode: "PINNED",
    requestedProvider: "groq",
    requestedModel: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    actualProvider: "groq",
    actualModel: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    brokerIdentity: null,
    brokerVersion: null,
    upstreamRequestId: "chatcmpl-simplify-1",
    routeProvenance: "COMPLETE",
  });
});

test("Groq simplifier route refuses tool semantics and fails closed when actual model identity is absent or different", async () => {
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: API_KEY,
    fetchImpl: async () => new Response(JSON.stringify({
      id: "chatcmpl-wrong-model",
      model: "openai/gpt-oss-20b",
      choices: [{ message: { content: "text" } }],
    }), { status: 200 }),
  });
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider);

  await assert.rejects(runtime.call(request(), {
    correlationId: "wrong-model",
    maxAttempts: 1,
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "invalid_output");
    return true;
  });

  await assert.rejects(runtime.call({
    ...request(),
    tools: [{
      name: "not_allowed",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    }],
  }, {
    correlationId: "tool-refusal",
    maxAttempts: 1,
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "unsupported_capability");
    return true;
  });
});

test("Groq simplifier route preserves bounded failure and cancellation behavior", async () => {
  for (const candidate of [
    { response: new Response("not-json", { status: 200 }), code: "malformed_response" },
    { response: new Response("rate", { status: 429 }), code: "rate_limit" },
    { response: new Response("down", { status: 503 }), code: "unavailable" },
  ]) {
    const runtime = new GroqKnowledgeSimplifierModelRuntime(
      new GroqKnowledgeSimplifierModelProvider({
        apiKey: API_KEY,
        fetchImpl: async () => candidate.response,
      }),
    );
    await assert.rejects(runtime.call(request(), {
      correlationId: `failure-${candidate.code}`,
      maxAttempts: 1,
    }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, candidate.code);
      return true;
    });
  }

  const controller = new AbortController();
  const runtime = new GroqKnowledgeSimplifierModelRuntime(
    new GroqKnowledgeSimplifierModelProvider({
      apiKey: API_KEY,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    }),
  );
  const pending = runtime.call(request(), {
    correlationId: "cancelled-groq-simplifier",
    maxAttempts: 1,
    signal: controller.signal,
  });
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: string }).code, "cancelled");
    return true;
  });
});
