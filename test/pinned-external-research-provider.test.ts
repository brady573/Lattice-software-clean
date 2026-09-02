import assert from "node:assert/strict";
import test from "node:test";
import { ModelRuntime } from "../src/model/runtime.js";
import { PinnedExternalResearchModelProvider } from "../src/model/pinned-external-research-provider.js";

function request() {
  return {
    model: "provider/model",
    messages: [
      { role: "system" as const, content: "Emit one tool call." },
      { role: "user" as const, content: "{}" },
    ],
    tools: [{
      name: "research_lookup",
      inputSchema: {
        type: "object" as const,
        properties: { query: { type: "string" as const } },
        required: ["query"],
        additionalProperties: false as const,
      },
    }],
    temperature: 0,
    maxOutputTokens: 64,
  };
}

test("M9-5 pinned external research provider emits complete LIVE_DIRECT provenance", async () => {
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  const provider = new PinnedExternalResearchModelProvider({
    baseUrl: "https://provider.example/v1",
    providerId: "fixture-provider",
    apiKey: "fixture-secret",
    fetchImpl: async (input, init) => {
      observedUrl = String(input);
      observedInit = init;
      return new Response(JSON.stringify({
        id: "upstream-1",
        model: "provider/model",
        choices: [{ message: { tool_calls: [{
          id: "call-1",
          function: { name: "research_lookup", arguments: JSON.stringify({ query: "bounded" }) },
        }] } }],
      }), { status: 200 });
    },
  });
  const runtime = new ModelRuntime(provider);
  const result = await runtime.call(request(), {
    correlationId: "m9-5-provider-test",
    maxAttempts: 1,
    invocation: {
      executionClass: "LIVE_DIRECT",
      routeMode: "PINNED",
      requestedProvider: "fixture-provider",
    },
  });
  assert.equal(observedUrl, "https://provider.example/v1/chat/completions");
  assert.equal(observedInit?.method, "POST");
  assert.equal(observedInit?.redirect, "error");
  assert.equal((observedInit?.headers as Record<string, string>).authorization, "Bearer fixture-secret");
  assert.equal(result.audit.invocationProvenance.actualProvider, "fixture-provider");
  assert.equal(result.audit.invocationProvenance.actualModel, "provider/model");
  assert.equal(result.audit.invocationProvenance.routeProvenance, "COMPLETE");
  assert.equal(result.response.output.length, 1);
  assert.equal(result.response.output[0]?.type, "tool_call");
});

test("M9-5 pinned external provider rejects non-HTTPS, credential-bearing, and unpinned API roots", () => {
  for (const baseUrl of [
    "http://provider.example/v1",
    "https://user:pass@provider.example/v1",
    "https://provider.example/",
    "https://provider.example/v1?route=dynamic",
  ]) {
    assert.throws(() => new PinnedExternalResearchModelProvider({
      baseUrl,
      providerId: "fixture-provider",
      apiKey: "fixture-secret",
    }));
  }
});

test("M9-5 pinned external provider fails closed on prose, multiple calls, malformed JSON, 429 and 5xx", async () => {
  const cases: Array<{ response: Response; code: string }> = [
    { response: new Response(JSON.stringify({ choices: [{ message: { content: "prose" } }] }), { status: 200 }), code: "invalid_output" },
    { response: new Response(JSON.stringify({ choices: [{ message: { tool_calls: [
      { id: "a", function: { name: "research_lookup", arguments: "{}" } },
      { id: "b", function: { name: "research_lookup", arguments: "{}" } },
    ] } }] }), { status: 200 }), code: "invalid_output" },
    { response: new Response("not-json", { status: 200 }), code: "malformed_response" },
    { response: new Response("rate", { status: 429 }), code: "rate_limit" },
    { response: new Response("down", { status: 503 }), code: "unavailable" },
  ];
  for (const candidate of cases) {
    const runtime = new ModelRuntime(new PinnedExternalResearchModelProvider({
      baseUrl: "https://provider.example/v1",
      providerId: "fixture-provider",
      apiKey: "fixture-secret",
      fetchImpl: async () => candidate.response,
    }));
    await assert.rejects(runtime.call(request(), {
      correlationId: `case-${candidate.code}`,
      maxAttempts: 1,
      invocation: { executionClass: "LIVE_DIRECT", routeMode: "PINNED", requestedProvider: "fixture-provider" },
    }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, candidate.code);
      return true;
    });
  }
});

test("M9-5 pinned external provider preserves caller cancellation", async () => {
  const controller = new AbortController();
  const runtime = new ModelRuntime(new PinnedExternalResearchModelProvider({
    baseUrl: "https://provider.example/v1",
    providerId: "fixture-provider",
    apiKey: "fixture-secret",
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  }));
  const pending = runtime.call(request(), {
    correlationId: "cancel-case",
    maxAttempts: 1,
    signal: controller.signal,
    invocation: { executionClass: "LIVE_DIRECT", routeMode: "PINNED", requestedProvider: "fixture-provider" },
  });
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: string }).code, "cancelled");
    return true;
  });
});
