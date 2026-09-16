import assert from "node:assert/strict";
import test from "node:test";
import { ModelProviderError, ModelRuntime, type CanonicalModelRequest } from "../src/model/index.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
} from "../src/model/groq-knowledge-simplifier.js";

const STRUCTURED_REQUEST: CanonicalModelRequest = Object.freeze({
  model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  messages: Object.freeze([{ role: "user" as const, content: "Return a bounded structured result." }]),
  structuredOutput: Object.freeze({
    requirement: "REQUIRED" as const,
    format: "JSON_SCHEMA" as const,
    name: "error_classification_result",
    strict: true,
    schema: Object.freeze({
      type: "object" as const,
      properties: Object.freeze({
        answer: Object.freeze({ type: "string" as const }),
      }),
      required: Object.freeze(["answer"]),
      additionalProperties: false as const,
    }),
  }),
  temperature: 0,
  maxOutputTokens: 128,
});

function providerForError(error: Record<string, unknown>): GroqKnowledgeSimplifierModelProvider {
  return new GroqKnowledgeSimplifierModelProvider({
    apiKey: "gsk_test_structured_output_error_key",
    fetchImpl: async () => new Response(JSON.stringify({ error }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  });
}

test("Groq schema-definition rejection remains unsupported capability with bounded provider detail", async () => {
  const runtime = new ModelRuntime(providerForError({
    code: "invalid_request_error",
    type: "invalid_request_error",
    param: "response_format",
    message: "schema must have type 'object' and not have 'oneOf'/'anyOf'/'enum'/'not' at the top level",
  }));

  await assert.rejects(
    () => runtime.call(STRUCTURED_REQUEST, { correlationId: "schema-definition-rejection" }),
    (error: unknown) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.code, "unsupported_capability");
      assert.equal(error.statusCode, 400);
      assert.equal(error.retryable, false);
      assert.deepEqual(error.providerError, {
        code: "invalid_request_error",
        type: "invalid_request_error",
        param: "response_format",
        message: "schema must have type 'object' and not have 'oneOf'/'anyOf'/'enum'/'not' at the top level",
      });
      return true;
    },
  );
});

test("Groq json_validate_failed is invalid output rather than unsupported capability", async () => {
  const longMessage = `  generated JSON failed\nvalidation\u0000 ${"x".repeat(5_000)}  `;
  const runtime = new ModelRuntime(providerForError({
    code: "json_validate_failed",
    type: "invalid_request_error",
    param: "response_format",
    message: longMessage,
    failed_generation: "diagnostic-only provider material",
  }));

  await assert.rejects(
    () => runtime.call(STRUCTURED_REQUEST, { correlationId: "generated-schema-failure" }),
    (error: unknown) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.code, "invalid_output");
      assert.equal(error.statusCode, 400);
      assert.equal(error.retryable, false);
      assert.equal(error.providerError?.code, "json_validate_failed");
      assert.equal(error.providerError?.type, "invalid_request_error");
      assert.equal(error.providerError?.param, "response_format");
      assert.ok(error.providerError?.message?.startsWith("generated JSON failed validation "));
      assert.equal(error.providerError?.message?.includes("\n"), false);
      assert.ok((error.providerError?.message?.length ?? 0) <= 4 * 1024);
      assert.equal("failedGeneration" in (error.providerError ?? {}), false);
      return true;
    },
  );
});

test("Groq structured 400 detail remains optional when the provider body is not structured JSON", async () => {
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "gsk_test_structured_output_error_key",
    fetchImpl: async () => new Response("not-json", { status: 400 }),
  });

  await assert.rejects(
    () => new ModelRuntime(provider).call(STRUCTURED_REQUEST, { correlationId: "unparseable-error-body" }),
    (error: unknown) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.code, "unsupported_capability");
      assert.equal(error.providerError, null);
      return true;
    },
  );
});
