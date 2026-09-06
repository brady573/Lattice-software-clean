import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalModelRequestIdentity,
  ModelRuntime,
  validateCanonicalModelRequest,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";
import { PinnedExternalResearchModelProvider } from "../src/model/pinned-external-research-provider.js";

const schema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    details: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer", "details"],
  additionalProperties: false,
} as const;

function structuredRequest(): CanonicalModelRequest {
  return {
    model: "nvidia/model",
    messages: [{ role: "user", content: "Return the requested object." }],
    structuredOutput: { type: "json_schema", schema },
    temperature: 0,
    maxOutputTokens: 256,
  };
}

test("structured output schema is canonicalized and participates in request identity", () => {
  const first = validateCanonicalModelRequest(structuredRequest());
  const second = validateCanonicalModelRequest({
    ...structuredRequest(),
    structuredOutput: {
      type: "json_schema",
      schema: { ...schema, required: ["details", "answer"] },
    },
  });
  assert.equal(first.structuredOutput?.type, "json_schema");
  assert.notEqual(
    canonicalModelRequestIdentity(first),
    canonicalModelRequestIdentity(second),
  );
  assert.throws(() => validateCanonicalModelRequest({
    ...structuredRequest(),
    structuredOutput: { type: "json_schema", schema: { invalid: undefined } },
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "invalid_output");
    return true;
  });
});

test("runtime rejects structured output when provider does not declare support", async () => {
  class UnsupportedProvider implements ModelProvider {
    readonly kind = "unsupported-fixture";
    calls = 0;
    async generate(_request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
      this.calls += 1;
      return { response: { id: "never", model: "nvidia/model", output: [{ type: "text", text: "{}" }] } };
    }
  }
  const provider = new UnsupportedProvider();
  const runtime = new ModelRuntime(provider);
  await assert.rejects(runtime.call(structuredRequest(), {
    correlationId: "unsupported-structured-output",
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "unsupported_capability");
    return true;
  });
  assert.equal(provider.calls, 0);
});

test("pinned external adapter maps provider-neutral schema to native guided_json", async () => {
  let observedBody: Record<string, unknown> | null = null;
  const provider = new PinnedExternalResearchModelProvider({
    baseUrl: "https://integrate.api.nvidia.com/v1",
    providerId: "nvidia",
    apiKey: "fixture-secret",
    structuredOutputMode: "nvidia-guided-json",
    fetchImpl: async (_input, init) => {
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "structured-1",
        model: "nvidia/model",
        choices: [{ finish_reason: "stop", message: { content: '{"answer":"ok","details":[]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8 },
      }), { status: 200 });
    },
  });
  const runtime = new ModelRuntime(provider);
  const result = await runtime.call(structuredRequest(), {
    correlationId: "structured-native-map",
    invocation: {
      executionClass: "LIVE_DIRECT",
      routeMode: "PINNED",
      requestedProvider: "nvidia",
    },
  });
  assert.deepEqual(observedBody?.guided_json, schema);
  assert.equal(observedBody?.tools, undefined);
  assert.equal(result.response.output[0]?.type, "text");
  assert.deepEqual(result.response.usage, { inputTokens: 10, outputTokens: 8 });
  assert.equal(result.audit.invocationProvenance.actualProvider, "nvidia");
});

test("existing unconstrained pinned tool-call behavior remains unchanged", async () => {
  let observedBody: Record<string, unknown> | null = null;
  const provider = new PinnedExternalResearchModelProvider({
    baseUrl: "https://provider.example/v1",
    providerId: "fixture-provider",
    apiKey: "fixture-secret",
    structuredOutputMode: "nvidia-guided-json",
    fetchImpl: async (_input, init) => {
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "tool-1",
        model: "provider/model",
        choices: [{ message: { tool_calls: [{
          id: "call-1",
          function: { name: "lookup", arguments: '{"query":"bounded"}' },
        }] } }],
      }), { status: 200 });
    },
  });
  const runtime = new ModelRuntime(provider);
  const result = await runtime.call({
    model: "provider/model",
    messages: [{ role: "user", content: "Research." }],
    tools: [{
      name: "lookup",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    }],
    temperature: 0,
  }, { correlationId: "tool-path-unchanged" });
  assert.equal(observedBody?.guided_json, undefined);
  assert.equal(observedBody?.tool_choice, "required");
  assert.equal(result.response.output[0]?.type, "tool_call");
});
