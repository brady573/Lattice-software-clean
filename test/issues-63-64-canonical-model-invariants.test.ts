import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelProviderError,
  ModelRuntime,
  OpenAiCompatibleModelProvider,
  validateCanonicalModelRequest,
  type CanonicalModelMessage,
  type CanonicalModelRequest,
  type CanonicalModelToolProperty,
} from "../src/model/index.js";

// Compile-time invariant checks. These assignments must remain impossible.
// @ts-expect-error USER messages cannot carry tool-only linkage.
const invalidUserToolCall: CanonicalModelMessage = { role: "user", content: "user", toolCallId: "call-1" };
// @ts-expect-error SYSTEM messages cannot carry assistant-only names.
const invalidSystemName: CanonicalModelMessage = { role: "system", content: "system", name: "named-system" };
// @ts-expect-error TOOL messages require exact tool-call linkage.
const invalidToolWithoutLink: CanonicalModelMessage = { role: "tool", content: "result" };
// @ts-expect-error ASSISTANT messages cannot carry tool-result linkage.
const invalidAssistantToolCall: CanonicalModelMessage = { role: "assistant", content: "assistant", toolCallId: "call-1" };
// @ts-expect-error TOOL messages cannot carry assistant-only names.
const invalidToolName: CanonicalModelMessage = { role: "tool", content: "result", toolCallId: "call-1", name: "lookup" };
// @ts-expect-error String tool properties cannot declare numeric enum values.
const invalidStringEnum: CanonicalModelToolProperty = { type: "string", enum: [1] };
// @ts-expect-error Boolean tool properties cannot declare string enum values.
const invalidBooleanEnum: CanonicalModelToolProperty = { type: "boolean", enum: ["true"] };

void invalidUserToolCall;
void invalidSystemName;
void invalidToolWithoutLink;
void invalidAssistantToolCall;
void invalidToolName;
void invalidStringEnum;
void invalidBooleanEnum;

function requestWithMessage(message: unknown): unknown {
  return { model: "canonical-invariant-model", messages: [message] };
}

function requestWithProperty(property: unknown): unknown {
  return {
    model: "canonical-invariant-model",
    messages: [{ role: "user", content: "Use the tool." }],
    tools: [{
      name: "lookup",
      inputSchema: {
        type: "object",
        properties: { value: property },
        required: ["value"],
        additionalProperties: false,
      },
    }],
  };
}

function assertInvalidOutput(action: () => unknown, message: RegExp): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "invalid_output"
      && message.test(error.message),
  );
}

test("Issue #63: all valid canonical message role variants are accepted", () => {
  const request = validateCanonicalModelRequest({
    model: "canonical-invariant-model",
    messages: [
      { role: "system", content: "System instruction." },
      { role: "user", content: "User request." },
      { role: "assistant", content: "Assistant response.", name: "solandra" },
      { role: "tool", content: "Tool result.", toolCallId: "call-1" },
    ],
  });

  assert.deepEqual(request.messages, [
    { role: "system", content: "System instruction." },
    { role: "user", content: "User request." },
    { role: "assistant", content: "Assistant response.", name: "solandra" },
    { role: "tool", content: "Tool result.", toolCallId: "call-1" },
  ]);
});

test("Issue #63: role-invalid message properties fail closed at runtime", () => {
  assertInvalidOutput(
    () => validateCanonicalModelRequest(requestWithMessage({ role: "user", content: "User.", toolCallId: "call-1" })),
    /unsupported field\(s\): toolCallId/u,
  );
  assertInvalidOutput(
    () => validateCanonicalModelRequest(requestWithMessage({ role: "system", content: "System.", name: "named-system" })),
    /unsupported field\(s\): name/u,
  );
  assertInvalidOutput(
    () => validateCanonicalModelRequest(requestWithMessage({ role: "tool", content: "Result." })),
    /toolCallId is required/u,
  );
  assertInvalidOutput(
    () => validateCanonicalModelRequest(requestWithMessage({ role: "assistant", content: "Assistant.", toolCallId: "call-1" })),
    /unsupported field\(s\): toolCallId/u,
  );
  assertInvalidOutput(
    () => validateCanonicalModelRequest(requestWithMessage({ role: "tool", content: "Result.", toolCallId: "call-1", name: "lookup" })),
    /unsupported field\(s\): name/u,
  );
});

test("Issue #64: compatible string, number, integer, and boolean enums are accepted", () => {
  const request = validateCanonicalModelRequest({
    model: "canonical-invariant-model",
    messages: [{ role: "user", content: "Use the tool." }],
    tools: [{
      name: "lookup",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", enum: ["one", "two"] },
          score: { type: "number", enum: [1, 2.5] },
          count: { type: "integer", enum: [1, 2] },
          enabled: { type: "boolean", enum: [true, false] },
        },
        additionalProperties: false,
      },
    }],
  });

  assert.deepEqual(request.tools?.[0]?.inputSchema.properties, {
    text: { type: "string", enum: ["one", "two"] },
    score: { type: "number", enum: [1, 2.5] },
    count: { type: "integer", enum: [1, 2] },
    enabled: { type: "boolean", enum: [true, false] },
  });
});

test("Issue #64: incompatible, non-finite, and non-integer enum values fail closed", () => {
  const invalidProperties: readonly Readonly<{ property: unknown; message: RegExp }>[] = [
    { property: { type: "string", enum: ["one", 2] }, message: /match declared string type/u },
    { property: { type: "number", enum: [1, true] }, message: /match declared number type/u },
    { property: { type: "number", enum: [Number.POSITIVE_INFINITY] }, message: /match declared number type/u },
    { property: { type: "integer", enum: [1, 1.5] }, message: /match declared integer type/u },
    { property: { type: "boolean", enum: [true, "false"] }, message: /match declared boolean type/u },
  ];

  for (const { property, message } of invalidProperties) {
    assertInvalidOutput(
      () => validateCanonicalModelRequest(requestWithProperty(property)),
      message,
    );
  }
});

test("Issues #63/#64: valid canonical messages and tool enums serialize unchanged through the OpenAI-compatible adapter", async () => {
  let captured: unknown;
  const fetchImpl: typeof fetch = async (_input, init) => {
    captured = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "canonical-invariant-response",
      model: "canonical-invariant-model",
      choices: [{ message: { role: "assistant", content: "OK" } }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const provider = new OpenAiCompatibleModelProvider({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetchImpl,
  });
  const runtime = new ModelRuntime(provider);
  const request: CanonicalModelRequest = {
    model: "canonical-invariant-model",
    messages: [
      { role: "system", content: "System instruction." },
      { role: "user", content: "User request." },
      { role: "assistant", content: "Assistant response.", name: "solandra" },
      { role: "tool", content: "Tool result.", toolCallId: "call-1" },
    ],
    tools: [{
      name: "lookup",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["fast", "careful"] },
          limit: { type: "integer", enum: [1, 2, 3] },
          enabled: { type: "boolean", enum: [true, false] },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    }],
  };

  await runtime.call(request, { correlationId: "canonical-invariant-adapter" });

  assert.deepEqual(captured, {
    model: "canonical-invariant-model",
    messages: [
      { role: "system", content: "System instruction." },
      { role: "user", content: "User request." },
      { role: "assistant", content: "Assistant response.", name: "solandra" },
      { role: "tool", content: "Tool result.", tool_call_id: "call-1" },
    ],
    tools: [{
      type: "function",
      function: {
        name: "lookup",
        parameters: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["fast", "careful"] },
            limit: { type: "integer", enum: [1, 2, 3] },
            enabled: { type: "boolean", enum: [true, false] },
          },
          required: ["mode"],
          additionalProperties: false,
        },
      },
    }],
    chat_template_kwargs: { enable_thinking: false },
  });
});
