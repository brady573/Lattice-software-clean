import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ModelProviderError } from "../src/model/errors.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
  ModelRuntimeResult,
} from "../src/model/types.js";

/**
 * Issue #91 bounded runtime-reliability repair: an explicitly permitted retry
 * must not be structurally starved by the first attempt or by provider
 * readiness waiting, while the whole logical operation stays explicitly finite.
 */

const MODEL = "runtime-retry-policy-fixture";

function assistantText(response: ModelRuntimeResult["response"]): string | undefined {
  const first = response.output[0];
  return first !== undefined && "text" in first ? first.text : undefined;
}

function request(prompt: string): CanonicalModelRequest {
  return {
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    maxOutputTokens: 50,
  };
}

function textResult(id: string, text: string): ModelProviderResult {
  return {
    response: {
      id,
      model: MODEL,
      output: [{ type: "text", text }],
    },
    route: {
      actualProvider: "runtime-retry-policy-provider",
      actualModel: MODEL,
      upstreamRequestId: id,
    },
  } as ModelProviderResult;
}

/** Provider whose per-attempt behavior is scripted. */
class ScriptedProvider implements ModelProvider {
  readonly kind = "runtime-retry-policy-provider";
  calls = 0;
  readonly attemptSignals: AbortSignal[] = [];

  constructor(private readonly script: Array<"slow-success" | "hang" | "retryable" | "non-retryable" | "ready-slow-success">) {}

  async generate(
    modelRequest: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    this.attemptSignals.push(context.signal);
    const step = this.script.shift();
    assert.ok(step !== undefined, "scripted provider exhausted");
    if (step === "hang") {
      // Never resolves on its own: only the attempt window may end it.
      return await new Promise<ModelProviderResult>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason ?? new Error("aborted")), { once: true });
      });
    }
    if (step === "retryable") {
      throw new ModelProviderError("rate_limit", "controlled transient 429", { retryable: true, statusCode: 429 });
    }
    if (step === "non-retryable") {
      throw new ModelProviderError("invalid_output", "controlled permanent provider failure.");
    }
    if (step === "ready-slow-success") {
      // Simulates provider readiness waiting inside the attempt window.
      await delay(30);
      return textResult(`ready-${this.calls}`, "ready then answered");
    }
    return textResult(`slow-${this.calls}`, "answered after the first attempt window");
  }
}

function runtime(provider: ModelProvider, timeoutMs: number): ModelRuntime {
  return new ModelRuntime(provider, { timeoutMs });
}

test("a slow first attempt no longer starves an explicitly permitted retry", async () => {
  const provider = new ScriptedProvider(["hang", "slow-success"]);
  const model = runtime(provider, 120);
  const started = Date.now();
  const result = await model.call(request("bounded retry policy"), { correlationId: "retry-starvation", maxAttempts: 2 });
  const elapsed = Date.now() - started;
  assert.equal(assistantText(result.response), "answered after the first attempt window");
  assert.equal(provider.calls, 2, "the allowed second attempt ran after the first attempt window elapsed");
  assert.ok(elapsed >= 120, `the retry had to wait for its own window (took ${elapsed} ms)`);
  assert.ok(elapsed < 400, `the whole operation stayed bounded (took ${elapsed} ms)`);
});

test("the whole logical operation has an explicit finite upper bound", async () => {
  const provider = new ScriptedProvider(["hang", "hang", "hang"]);
  const model = runtime(provider, 80);
  const started = Date.now();
  await assert.rejects(
    model.call(request("bounded operation"), { correlationId: "operation-bound", maxAttempts: 3 }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "timeout",
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 200, `bounded attempts actually ran (took ${elapsed} ms)`);
  assert.ok(elapsed < 600, `the operation stayed finite, bounded by attempts x window (took ${elapsed} ms)`);
});

test("a caller cancellation still terminates the operation immediately", async () => {
  const provider = new ScriptedProvider(["hang", "slow-success"]);
  const model = runtime(provider, 5_000);
  const controller = new AbortController();
  const call = model.call(
    request("caller cancellation"),
    { correlationId: "caller-cancel", maxAttempts: 2, signal: controller.signal },
  );
  setTimeout(() => controller.abort(new Error("caller went away")), 30).unref();
  await assert.rejects(
    call,
    (error: unknown) => error instanceof ModelProviderError && error.code === "cancelled",
  );
  assert.equal(provider.calls, 1, "cancellation did not spend a second attempt");
});

test("non-retryable provider failures do not gain retries", async () => {
  const provider = new ScriptedProvider(["non-retryable", "slow-success"]);
  const model = runtime(provider, 1_000);
  await assert.rejects(
    model.call(request("non retryable"), { correlationId: "non-retryable", maxAttempts: 2 }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "invalid_output",
  );
  assert.equal(provider.calls, 1, "a permanent provider failure is not retried");
});

test("bounded retries are still exhausted rather than extended", async () => {
  const provider = new ScriptedProvider(["retryable", "retryable", "slow-success"]);
  const model = runtime(provider, 1_000);
  await assert.rejects(
    model.call(request("exhausted retries"), { correlationId: "exhausted", maxAttempts: 2 }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "rate_limit",
  );
  assert.equal(provider.calls, 2, "the configured maximum attempt count is enforced");
});

test("a successful first attempt incurs no artificial delay", async () => {
  const provider = new ScriptedProvider(["slow-success"]);
  const model = runtime(provider, 1_000);
  const started = Date.now();
  const result = await model.call(request("first attempt success"), { correlationId: "first-success", maxAttempts: 2 });
  assert.equal(assistantText(result.response), "answered after the first attempt window");
  assert.equal(provider.calls, 1);
  assert.ok(Date.now() - started < 200, "no waiting when the first attempt succeeds");
});

test("provider readiness waiting is covered by the attempt window", async () => {
  const provider = new ScriptedProvider(["ready-slow-success", "slow-success"]);
  const model = runtime(provider, 200);
  const result = await model.call(request("readiness wait"), { correlationId: "readiness", maxAttempts: 2 });
  assert.equal(assistantText(result.response), "ready then answered");
  assert.equal(provider.calls, 1, "a readiness wait inside the attempt window does not consume a retry");
});

test("callers that never request a retry keep exactly one bounded window", async () => {
  const provider = new ScriptedProvider(["hang"]);
  const model = runtime(provider, 90);
  const started = Date.now();
  await assert.rejects(
    model.call(request("single attempt"), { correlationId: "single-attempt" }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "timeout" && /exceeded its timeout/u.test(error.message),
  );
  const elapsed = Date.now() - started;
  assert.equal(provider.calls, 1);
  assert.ok(elapsed < 400, `single-attempt callers are not given a longer budget (took ${elapsed} ms)`);
});
