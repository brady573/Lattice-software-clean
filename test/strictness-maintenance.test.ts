import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelRuntime,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";

const request: CanonicalModelRequest = {
  model: "strictness-maintenance-fixture",
  messages: [{ role: "user", content: "bounded state" }],
};

class CountingProvider implements ModelProvider {
  readonly kind = "strictness-maintenance";
  calls = 0;
  readonly attempts: number[] = [];

  async generate(
    requestValue: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    this.attempts.push(context.attempt);
    return {
      response: {
        id: `strictness-${this.calls}`,
        model: requestValue.model,
        output: [{ type: "text", text: `attempt:${context.attempt}` }],
      },
    };
  }
}

test("bounded model idempotency state preserves LRU eviction ordering", async () => {
  const provider = new CountingProvider();
  const runtime = new ModelRuntime(provider, { maxStateEntries: 2 });
  const call = async (key: string) => await runtime.call(request, {
    correlationId: `idempotency-${key}`,
    idempotencyKey: "delivery",
  });

  await call("a");
  await call("b");
  await call("a");
  assert.equal(provider.calls, 2, "reading a cached entry must refresh it without another provider call");

  await call("c");
  await call("a");
  assert.equal(provider.calls, 3, "the refreshed entry must survive the next bounded eviction");

  await call("b");
  assert.equal(provider.calls, 4, "the least-recently-used entry must be the one evicted");
});

test("bounded attempt state preserves per-key recency and resets only an evicted key", async () => {
  const provider = new CountingProvider();
  const runtime = new ModelRuntime(provider, { maxStateEntries: 2 });
  const call = async (key: string) => await runtime.call(request, { correlationId: `attempt-${key}` });

  await call("a");
  await call("b");
  await call("a");
  await call("c");
  await call("a");
  await call("b");

  assert.deepEqual(provider.attempts, [0, 0, 1, 0, 2, 0]);
});
