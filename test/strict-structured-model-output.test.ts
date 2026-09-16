import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalModelRequestIdentity,
  ModelProviderError,
  ModelRuntime,
  OpenAiCompatibleModelProvider,
  validateCanonicalModelRequest,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
} from "../src/model/groq-knowledge-simplifier.js";
import { PinnedExternalResearchModelProvider } from "../src/model/pinned-external-research-provider.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

const SIMPLE_STRUCTURED_OUTPUT = Object.freeze({
  requirement: "REQUIRED" as const,
  format: "JSON_SCHEMA" as const,
  name: "simple_result",
  strict: true,
  schema: Object.freeze({
    type: "object" as const,
    properties: Object.freeze({
      answer: Object.freeze({ type: "string" as const }),
    }),
    required: Object.freeze(["answer"]),
    additionalProperties: false as const,
  }),
});

const SIMPLE_REQUEST: CanonicalModelRequest = Object.freeze({
  model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  messages: Object.freeze([{ role: "user" as const, content: "Return a bounded result." }]),
  structuredOutput: SIMPLE_STRUCTURED_OUTPUT,
  temperature: 0,
  maxOutputTokens: 128,
});

function groqResponse(content: string): Response {
  return new Response(JSON.stringify({
    id: "groq-structured-test",
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("canonical request validates bounded nested strict schemas and identity includes the output contract", () => {
  const first = validateCanonicalModelRequest(SIMPLE_REQUEST);
  const changed = validateCanonicalModelRequest({
    ...SIMPLE_REQUEST,
    structuredOutput: {
      ...SIMPLE_STRUCTURED_OUTPUT,
      name: "different_result",
    },
  });

  assert.equal(first.structuredOutput?.strict, true);
  assert.notEqual(canonicalModelRequestIdentity(first), canonicalModelRequestIdentity(changed));

  assert.throws(() => validateCanonicalModelRequest({
    ...SIMPLE_REQUEST,
    structuredOutput: {
      ...SIMPLE_STRUCTURED_OUTPUT,
      schema: {
        type: "object",
        properties: { answer: { type: "string" }, extra: { type: "boolean" } },
        required: ["answer"],
        additionalProperties: false,
      },
    },
  }), (error: unknown) => error instanceof ModelProviderError && error.code === "invalid_output");
});

test("canonical response validates required structured output after provider return", async () => {
  class Provider implements ModelProvider {
    readonly kind = "structured-response-fixture";
    constructor(private readonly content: string) {}
    async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
      return {
        response: {
          id: "structured-response",
          model: request.model,
          output: [{ type: "text", text: this.content }],
        },
      };
    }
  }

  const valid = await new ModelRuntime(new Provider(JSON.stringify({ answer: "ok" }))).call(
    SIMPLE_REQUEST,
    { correlationId: "structured-valid" },
  );
  assert.equal(valid.response.output[0]?.type, "text");

  await assert.rejects(
    () => new ModelRuntime(new Provider(JSON.stringify({ answer: 42 }))).call(
      SIMPLE_REQUEST,
      { correlationId: "structured-invalid" },
    ),
    (error: unknown) => error instanceof ModelProviderError && error.code === "invalid_output",
  );
});

test("Groq adapter sends canonical required output as native strict json_schema", async () => {
  let outbound: Record<string, unknown> | undefined;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "gsk_test_structured_output_key",
    fetchImpl: async (_url, init) => {
      outbound = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return groqResponse(JSON.stringify({ answer: "ok" }));
    },
  });
  const result = await new ModelRuntime(provider).call(SIMPLE_REQUEST, { correlationId: "groq-structured" });
  assert.equal(result.response.output[0]?.type, "text");
  assert.deepEqual(outbound?.response_format, {
    type: "json_schema",
    json_schema: {
      name: "simple_result",
      strict: true,
      schema: SIMPLE_STRUCTURED_OUTPUT.schema,
    },
  });
});

test("Groq rejection of a required structural contract is unsupported capability, not fallback", async () => {
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "gsk_test_structured_output_key",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "unsupported schema" } }), { status: 400 }),
  });
  await assert.rejects(
    () => new ModelRuntime(provider).call(SIMPLE_REQUEST, { correlationId: "groq-unsupported" }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "unsupported_capability",
  );
});

test("loopback OpenAI-compatible adapter preserves the same provider-neutral structured contract", async () => {
  let outbound: Record<string, unknown> | undefined;
  const provider = new OpenAiCompatibleModelProvider({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetchImpl: async (_url, init) => {
      outbound = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "local-structured-test",
        model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
        choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "local" }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await new ModelRuntime(provider).call(SIMPLE_REQUEST, { correlationId: "local-structured" });
  assert.deepEqual(outbound?.response_format, {
    type: "json_schema",
    json_schema: {
      name: "simple_result",
      strict: true,
      schema: SIMPLE_STRUCTURED_OUTPUT.schema,
    },
  });
});

test("provider without structured-output support refuses the required capability before dispatch", async () => {
  let called = false;
  const provider = new PinnedExternalResearchModelProvider({
    baseUrl: "https://provider.example/v1",
    providerId: "fixture-provider",
    apiKey: "fixture-key",
    fetchImpl: async () => {
      called = true;
      throw new Error("must not dispatch");
    },
  });
  const request: CanonicalModelRequest = {
    ...SIMPLE_REQUEST,
    tools: [{
      name: "lookup",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    }],
  };
  await assert.rejects(
    () => new ModelRuntime(provider).call(request, { correlationId: "unsupported-provider" }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "unsupported_capability",
  );
  assert.equal(called, false);
});

class QueueCognitionProvider implements ModelProvider {
  readonly kind = "strict-cognition-fixture";
  readonly requests: CanonicalModelRequest[] = [];
  constructor(private readonly outputs: readonly unknown[]) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    const index = this.requests.length;
    this.requests.push(structuredClone(request));
    const output = this.outputs[index];
    if (output === undefined) throw new Error("Unexpected cognition request.");
    return {
      response: {
        id: `strict-cognition-${index}`,
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(output) }],
      },
    };
  }
}

const governedProjection = Object.freeze({
  objectiveRelation: "NEW_OBJECTIVE" as const,
  proposedObjective: "Find trustworthy current guidance.",
  requestedHelp: "KNOWLEDGE" as const,
  relevantContext: Object.freeze([]),
  entities: Object.freeze([]),
  referents: Object.freeze([]),
  constraints: Object.freeze([]),
  preferences: Object.freeze([]),
  knowledgeNeeds: Object.freeze(["Current trustworthy guidance"]),
  materialAmbiguity: null,
  referencedKnowledgeId: null,
  referencedRecommendationId: null,
  referencedOptionId: null,
});

test("Solandra cognition uses one strict structural contract for short, substantive, and governed results", async () => {
  const provider = new QueueCognitionProvider([
    { mode: "CONVERSATION", response: "A short natural reply.", projection: null },
    {
      mode: "CONVERSATION",
      response: "A longer ordinary explanation with multiple useful considerations that remains ordinary conversation.",
      projection: null,
    },
    { mode: "GOVERNED", response: null, projection: governedProjection },
  ]);
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "strict-cognition-model");
  const base = {
    conversationId: "strict-cognition",
    recentUserMessages: [] as string[],
    governedKnowledge: [],
    governedRecommendations: [],
  };

  const short = await cognition.interpret({ ...base, messageId: "short", message: "Brainstorm a name." });
  assert.equal(short.mode, "CONVERSATION");
  const substantive = await cognition.interpret({ ...base, messageId: "substantive", message: "Explain a planning approach." });
  assert.equal(substantive.mode, "CONVERSATION");
  const governed = await cognition.interpret({ ...base, messageId: "governed", message: "Establish current trustworthy guidance." });
  assert.equal(governed.mode, "GOVERNED");

  for (const request of provider.requests) {
    assert.equal(request.structuredOutput?.requirement, "REQUIRED");
    assert.equal(request.structuredOutput?.format, "JSON_SCHEMA");
    assert.equal(request.structuredOutput?.strict, true);
    assert.equal(request.structuredOutput?.name, "solandra_cognition_result");
  }
});

test("provider-valid structure does not bypass Solandra semantic validation", async () => {
  const provider = new QueueCognitionProvider([{
    mode: "GOVERNED",
    response: null,
    projection: {
      ...governedProjection,
      requestedHelp: "COGNITIVE_ASSISTANCE",
    },
  }]);
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), "strict-cognition-model");
  await assert.rejects(
    () => cognition.interpret({
      conversationId: "semantic-boundary",
      messageId: "semantic-invalid",
      message: "Help me think about this.",
      recentUserMessages: [],
      governedKnowledge: [],
      governedRecommendations: [],
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "invalid_output",
  );
});
