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
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../src/model/groq-knowledge-simplifier.js";

const API_KEY = "gsk_fixture_structured_output_key_1234567890";
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
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
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
  assert.notEqual(canonicalModelRequestIdentity(first), canonicalModelRequestIdentity(second));
  assert.throws(() => validateCanonicalModelRequest({
    ...structuredRequest(),
    structuredOutput: { type: "json_schema", schema: { invalid: undefined } },
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "invalid_output");
    return true;
  });
});

test("runtime rejects structured output before calling a provider that does not declare support", async () => {
  class UnsupportedProvider implements ModelProvider {
    readonly kind = "unsupported-fixture";
    calls = 0;
    async generate(_request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
      this.calls += 1;
      return { response: { id: "never", model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL, output: [{ type: "text", text: "{}" }] } };
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

test("Groq adapter maps provider-neutral structured output to strict native JSON Schema", async () => {
  let observedBody: Record<string, unknown> = {};
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: API_KEY,
    fetchImpl: async (_input, init) => {
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "structured-1",
        model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
        choices: [{ finish_reason: "stop", message: { content: '{"answer":"ok","details":[]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
      }), { status: 200 });
    },
  });
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider);
  const result = await runtime.call(structuredRequest(), {
    correlationId: "structured-native-map",
    maxAttempts: 1,
  });

  assert.deepEqual(observedBody.response_format, {
    type: "json_schema",
    json_schema: {
      name: "lattice_structured_output",
      strict: true,
      schema,
    },
  });
  assert.equal(result.response.output[0]?.type, "text");
  assert.equal(result.audit.providerMetadata.promptTokens, 10);
  assert.equal(result.audit.providerMetadata.completionTokens, 8);
});

test("ordinary unstructured Groq calls do not send response_format", async () => {
  let observedBody: Record<string, unknown> = {};
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: API_KEY,
    fetchImpl: async (_input, init) => {
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "plain-1",
        model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
        choices: [{ finish_reason: "stop", message: { content: "plain text" } }],
      }), { status: 200 });
    },
  });
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider);
  const result = await runtime.call({
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Answer normally." }],
  }, {
    correlationId: "plain-call",
    maxAttempts: 1,
  });

  assert.equal(observedBody.response_format, undefined);
  assert.deepEqual(result.response.output[0], { type: "text", text: "plain text" });
});
