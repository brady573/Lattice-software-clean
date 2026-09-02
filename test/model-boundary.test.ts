import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  canonicalModelRequestIdentity,
  DeterministicFixtureModelProvider,
  ModelProviderError,
  ModelRuntime,
  OpenAiCompatibleModelProvider,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";

const fixtureRequest: CanonicalModelRequest = {
  model: "offline-fixture",
  messages: [{ role: "user", content: "hello" }],
  temperature: 0,
  maxOutputTokens: 128,
  tools: [{
    name: "lookup",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  }],
};

function fixtureProvider(response: unknown = {
  id: "fixture-hello",
  model: "offline-fixture",
  output: [{ type: "text", text: "HELLO_OK" }],
  usage: { inputTokens: 4, outputTokens: 2 },
}): DeterministicFixtureModelProvider {
  return new DeterministicFixtureModelProvider([{
    id: "hello",
    request: fixtureRequest,
    response,
  }]);
}

class TrackingProvider implements ModelProvider {
  readonly kind = "tracking";
  calls = 0;
  active = 0;
  maxActive = 0;
  readonly attempts: number[] = [];

  constructor(
    private readonly delayMs: number,
    private readonly failFirst = false,
  ) {}

  async generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.attempts.push(context.attempt);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        context.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(context.signal.reason ?? new Error("cancelled"));
        }, { once: true });
      });
      if (this.failFirst && context.attempt === 0) {
        throw new ModelProviderError("rate_limit", "retry me", {
          retryable: true,
          statusCode: 429,
        });
      }
      return {
        response: {
          id: `tracking-${context.attempt}`,
          model: request.model,
          output: [{ type: "text", text: `attempt:${context.attempt}` }],
        },
      };
    } finally {
      this.active -= 1;
    }
  }
}

async function withUpstream(
  handler: http.RequestListener,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP test server address.");
  }
  try {
    await fn(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
}

test("canonical request identity ignores object key insertion order", () => {
  const reordered: CanonicalModelRequest = {
    messages: [{ content: "hello", role: "user" }],
    model: "offline-fixture",
    tools: [{
      inputSchema: {
        additionalProperties: false,
        required: ["query"],
        properties: {
          limit: { type: "integer" },
          query: { type: "string" },
        },
        type: "object",
      },
      name: "lookup",
    }],
    maxOutputTokens: 128,
    temperature: 0,
  };
  assert.equal(
    canonicalModelRequestIdentity(fixtureRequest),
    canonicalModelRequestIdentity(reordered),
  );
});

test("deterministic fixture round-trips and provider authority-like extras are inert", async () => {
  const secretPrompt = "SECRET_PROMPT_7429";
  const authorityRequest: CanonicalModelRequest = {
    ...fixtureRequest,
    messages: [{ role: "user", content: secretPrompt }],
  };
  const provider = new DeterministicFixtureModelProvider([{
    id: "fixture-authority",
    request: authorityRequest,
    response: {
      id: "fixture-extra",
      model: "offline-fixture",
      output: [{ type: "text", text: "HELLO_OK" }],
      usage: { inputTokens: 1, outputTokens: 1 },
      verified: true,
      admitted: true,
      confidence: 1,
      truthVerdict: "TRUE",
    },
  }]);
  const runtime = new ModelRuntime(provider);
  const result = await runtime.call(authorityRequest, { correlationId: "run-1" });

  assert.equal(result.response.output[0]?.type, "text");
  assert.equal("verified" in result.response, false);
  assert.equal("admitted" in result.response, false);
  assert.equal("confidence" in result.response, false);
  assert.equal("truthVerdict" in result.response, false);
  assert.equal(JSON.stringify(result.audit).includes(secretPrompt), false);
});

test("unknown deterministic fixture fails closed", async () => {
  const runtime = new ModelRuntime(fixtureProvider());
  const unknown = {
    ...fixtureRequest,
    messages: [{ role: "user" as const, content: "not-the-fixture" }],
  };
  await assert.rejects(
    () => runtime.call(unknown, { correlationId: "run-unknown" }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "fixture_not_found",
  );
});

test("tool calls are validated proposals and undeclared or invalid arguments fail closed", async () => {
  const valid = new ModelRuntime(fixtureProvider({
    id: "tool-valid",
    model: "offline-fixture",
    output: [{
      type: "tool_call",
      id: "call-1",
      name: "lookup",
      arguments: { query: "laptop", limit: 3 },
    }],
  }));
  const validResult = await valid.call(fixtureRequest, { correlationId: "tool-valid" });
  assert.deepEqual(validResult.response.output[0], {
    type: "tool_call",
    id: "call-1",
    name: "lookup",
    arguments: { query: "laptop", limit: 3 },
  });

  const invalid = new ModelRuntime(fixtureProvider({
    id: "tool-invalid",
    model: "offline-fixture",
    output: [{
      type: "tool_call",
      id: "call-2",
      name: "lookup",
      arguments: { query: "laptop", limit: "three" },
    }],
  }));
  await assert.rejects(
    () => invalid.call(fixtureRequest, { correlationId: "tool-invalid" }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "invalid_output",
  );
});

test("duplicate delivery coalesces while distinct retries remain distinct attempts", async () => {
  const provider = new TrackingProvider(20, true);
  const runtime = new ModelRuntime(provider);

  const [first, duplicate] = await Promise.all([
    runtime.call(fixtureRequest, {
      correlationId: "retry-run",
      idempotencyKey: "delivery-1",
      maxAttempts: 2,
    }),
    runtime.call(fixtureRequest, {
      correlationId: "retry-run",
      idempotencyKey: "delivery-1",
      maxAttempts: 2,
    }),
  ]);

  assert.equal(provider.calls, 2);
  assert.deepEqual(provider.attempts, [0, 1]);
  assert.deepEqual(first.response, duplicate.response);

  await runtime.call(fixtureRequest, {
    correlationId: "retry-run",
    idempotencyKey: "delivery-2",
  });
  assert.equal(provider.calls, 3);
  assert.deepEqual(provider.attempts, [0, 1, 2]);
});

test("terminally rejected idempotent delivery is evicted while a successful replay remains cached", async () => {
  const provider = new TrackingProvider(20, true);
  const runtime = new ModelRuntime(provider);
  const options = {
    correlationId: "terminal-rejection",
    idempotencyKey: "delivery-1",
    maxAttempts: 1,
  } as const;

  const [first, duplicate] = await Promise.allSettled([
    runtime.call(fixtureRequest, options),
    runtime.call(fixtureRequest, options),
  ]);

  for (const outcome of [first, duplicate]) {
    assert.equal(outcome.status, "rejected");
    if (outcome.status !== "rejected") {
      throw new Error("Expected terminally rejected duplicate delivery.");
    }
    assert.ok(outcome.reason instanceof ModelProviderError);
    assert.equal(outcome.reason.code, "rate_limit");
  }
  assert.equal(provider.calls, 1);
  assert.deepEqual(provider.attempts, [0]);

  const replay = await runtime.call(fixtureRequest, options);
  assert.equal(provider.calls, 2);
  assert.deepEqual(provider.attempts, [0, 1]);

  const cachedReplay = await runtime.call(fixtureRequest, options);
  assert.equal(provider.calls, 2);
  assert.deepEqual(cachedReplay.response, replay.response);
});

test("same logical call serializes while independent correlations remain concurrent", async () => {
  const sameProvider = new TrackingProvider(20);
  const sameRuntime = new ModelRuntime(sameProvider);
  await Promise.all([
    sameRuntime.call(fixtureRequest, { correlationId: "same" }),
    sameRuntime.call(fixtureRequest, { correlationId: "same" }),
  ]);
  assert.equal(sameProvider.maxActive, 1);
  assert.deepEqual(sameProvider.attempts, [0, 1]);

  const independentProvider = new TrackingProvider(20);
  const independentRuntime = new ModelRuntime(independentProvider);
  await Promise.all([
    independentRuntime.call(fixtureRequest, { correlationId: "a" }),
    independentRuntime.call(fixtureRequest, { correlationId: "b" }),
  ]);
  assert.equal(independentProvider.maxActive, 2);
});

test("queued caller cancellation is prompt and does not let a successor bypass ordering", async () => {
  const provider = new TrackingProvider(150);
  const runtime = new ModelRuntime(provider, { timeoutMs: 1_000 });
  const first = runtime.call(fixtureRequest, {
    correlationId: "queued",
    idempotencyKey: "first",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("cancel queued")), 20);
  const started = performance.now();
  await assert.rejects(
    () => runtime.call(fixtureRequest, {
      correlationId: "queued",
      idempotencyKey: "second",
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "cancelled",
  );
  assert.ok(performance.now() - started < 100);

  const third = runtime.call(fixtureRequest, {
    correlationId: "queued",
    idempotencyKey: "third",
  });
  await first;
  await third;

  assert.equal(provider.maxActive, 1);
  assert.deepEqual(provider.attempts, [0, 1]);
});

test("timeout and caller cancellation are distinct", async () => {
  const timeoutRuntime = new ModelRuntime(new TrackingProvider(100), { timeoutMs: 20 });
  await assert.rejects(
    () => timeoutRuntime.call(fixtureRequest, { correlationId: "timeout" }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "timeout",
  );

  const cancelRuntime = new ModelRuntime(new TrackingProvider(100), { timeoutMs: 1_000 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("caller cancel")), 20);
  await assert.rejects(
    () => cancelRuntime.call(fixtureRequest, {
      correlationId: "cancel",
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "cancelled",
  );
});

test("OpenAI-compatible adapter rejects remote endpoints in the first offline boundary", () => {
  assert.throws(
    () => new OpenAiCompatibleModelProvider({ baseUrl: "https://api.example.com/v1" }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "unsupported_capability",
  );
});

test("OpenAI-compatible adapter fails closed on malformed JSON", async () => {
  await withUpstream((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{bad");
  }, async (baseUrl) => {
    const runtime = new ModelRuntime(new OpenAiCompatibleModelProvider({ baseUrl }));
    await assert.rejects(
      () => runtime.call(fixtureRequest, { correlationId: "malformed" }),
      (error: unknown) =>
        error instanceof ModelProviderError
        && error.code === "malformed_response",
    );
  });
});

test("OpenAI-compatible adapter rejects oversized responses before canonical parsing", async () => {
  await withUpstream((_request, response) => {
    const body = JSON.stringify({
      id: "oversized",
      model: "offline-fixture",
      choices: [{ message: { role: "assistant", content: "x".repeat(16_000) } }],
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  }, async (baseUrl) => {
    const runtime = new ModelRuntime(
      new OpenAiCompatibleModelProvider({
        baseUrl,
        maxResponseBytes: 4_096,
      }),
    );
    await assert.rejects(
      () => runtime.call(fixtureRequest, { correlationId: "oversized" }),
      (error: unknown) =>
        error instanceof ModelProviderError
        && error.code === "response_too_large",
    );
  });
});

test("OpenAI-compatible adapter strips provider-native authority fields", async () => {
  await withUpstream((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      id: "upstream-1",
      model: "offline-fixture",
      verified: true,
      admitted: true,
      confidence: 1,
      truthVerdict: "TRUE",
      choices: [{ message: { role: "assistant", content: "HELLO_OK" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }));
  }, async (baseUrl) => {
    const runtime = new ModelRuntime(new OpenAiCompatibleModelProvider({ baseUrl }));
    const result = await runtime.call(fixtureRequest, { correlationId: "authority" });
    assert.equal(result.response.output[0]?.type, "text");
    assert.equal("verified" in result.response, false);
    assert.equal("admitted" in result.response, false);
    assert.equal("confidence" in result.response, false);
    assert.equal("truthVerdict" in result.response, false);
  });
});
