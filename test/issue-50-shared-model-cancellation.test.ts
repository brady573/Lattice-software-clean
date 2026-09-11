import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelProviderError,
  ModelRuntime,
  type CanonicalModelRequest,
  type ModelCallContext,
  type ModelProvider,
  type ModelProviderResult,
} from "../src/model/index.js";

const request: CanonicalModelRequest = {
  model: "issue-50-fixture",
  messages: [{ role: "user", content: "shared work" }],
  temperature: 0,
  maxOutputTokens: 32,
};

class DelayedProvider implements ModelProvider {
  readonly kind = "issue-50-delayed";
  calls = 0;
  aborts = 0;
  attempts: number[] = [];

  constructor(
    private readonly delayMs: number,
    private failuresRemaining = 0,
  ) {}

  async generate(
    canonicalRequest: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    this.attempts.push(context.attempt);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.delayMs);
      context.signal.addEventListener("abort", () => {
        this.aborts += 1;
        clearTimeout(timer);
        reject(context.signal.reason ?? new Error("provider aborted"));
      }, { once: true });
    });
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new ModelProviderError("unavailable", "shared provider failure");
    }
    return {
      response: {
        id: `issue-50-${context.attempt}`,
        model: canonicalRequest.model,
        output: [{ type: "text", text: "SHARED_OK" }],
      },
    };
  }
}

function sharedOptions(signal?: AbortSignal) {
  return {
    correlationId: "issue-50-shared",
    idempotencyKey: "delivery-1",
    ...(signal === undefined ? {} : { signal }),
  } as const;
}

async function expectCancelled(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    () => promise,
    (error: unknown) => error instanceof ModelProviderError && error.code === "cancelled",
  );
}

test("Issue #50: first caller cancellation does not cancel a duplicate waiter", async () => {
  const provider = new DelayedProvider(60);
  const runtime = new ModelRuntime(provider, { timeoutMs: 500 });
  const firstController = new AbortController();

  const first = runtime.call(request, sharedOptions(firstController.signal));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = runtime.call(request, sharedOptions());
  setTimeout(() => firstController.abort(new Error("first caller left")), 10);

  await expectCancelled(first);
  const secondResult = await second;

  assert.equal(secondResult.response.output[0]?.type, "text");
  assert.equal(provider.calls, 1);
  assert.equal(provider.aborts, 0);
});

test("Issue #50: duplicate caller cancellation does not cancel the creator waiter", async () => {
  const provider = new DelayedProvider(60);
  const runtime = new ModelRuntime(provider, { timeoutMs: 500 });
  const secondController = new AbortController();

  const first = runtime.call(request, sharedOptions());
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = runtime.call(request, sharedOptions(secondController.signal));
  setTimeout(() => secondController.abort(new Error("duplicate caller left")), 10);

  await expectCancelled(second);
  const firstResult = await first;

  assert.equal(firstResult.response.output[0]?.type, "text");
  assert.equal(provider.calls, 1);
  assert.equal(provider.aborts, 0);
});

test("Issue #50: final waiter cancellation cancels shared provider work and permits later retry", async () => {
  const provider = new DelayedProvider(100);
  const runtime = new ModelRuntime(provider, { timeoutMs: 500 });
  const firstController = new AbortController();
  const secondController = new AbortController();

  const first = runtime.call(request, sharedOptions(firstController.signal));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = runtime.call(request, sharedOptions(secondController.signal));
  firstController.abort(new Error("first caller left"));
  secondController.abort(new Error("second caller left"));

  await Promise.all([expectCancelled(first), expectCancelled(second)]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(provider.calls, 1);
  assert.equal(provider.aborts, 1);

  const retry = await runtime.call(request, sharedOptions());
  assert.equal(retry.response.output[0]?.type, "text");
  assert.equal(provider.calls, 2);
  assert.deepEqual(provider.attempts, [0, 1]);
});

test("Issue #50: shared provider failure reaches active waiters and is evicted for later retry", async () => {
  const provider = new DelayedProvider(40, 1);
  const runtime = new ModelRuntime(provider, { timeoutMs: 500 });
  const cancelledController = new AbortController();

  const active = runtime.call(request, sharedOptions());
  const cancelled = runtime.call(request, sharedOptions(cancelledController.signal));
  setTimeout(() => cancelledController.abort(new Error("caller left before failure")), 5);

  await expectCancelled(cancelled);
  await assert.rejects(
    () => active,
    (error: unknown) => error instanceof ModelProviderError && error.code === "unavailable",
  );
  assert.equal(provider.calls, 1);

  const retry = await runtime.call(request, sharedOptions());
  assert.equal(retry.response.output[0]?.type, "text");
  assert.equal(provider.calls, 2);
  assert.deepEqual(provider.attempts, [0, 1]);
});

test("Issue #50: shared provider timeout remains distinct from one waiter's cancellation", async () => {
  const provider = new DelayedProvider(200);
  const runtime = new ModelRuntime(provider, { timeoutMs: 35 });
  const cancelledController = new AbortController();

  const cancelled = runtime.call(request, sharedOptions(cancelledController.signal));
  const active = runtime.call(request, sharedOptions());
  setTimeout(() => cancelledController.abort(new Error("caller cancellation")), 5);

  await expectCancelled(cancelled);
  await assert.rejects(
    () => active,
    (error: unknown) => error instanceof ModelProviderError && error.code === "timeout",
  );

  assert.equal(provider.calls, 1);
  assert.equal(provider.aborts, 1);
});
