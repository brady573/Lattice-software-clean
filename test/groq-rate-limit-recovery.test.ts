import assert from "node:assert/strict";
import test from "node:test";
import { ModelProviderError } from "../src/model/errors.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from "../src/model/groq-knowledge-simplifier.js";
import {
  MemoryGroqRateLimitCoordinator,
  groqRateLimitScopeId,
  type GroqRateLimitWait,
} from "../src/model/groq-rate-limit-coordinator.js";
import type { CanonicalModelRequest, ModelCallContext } from "../src/model/types.js";

const KEY_A = "gsk_test_rate_limit_recovery_key_aaaaaaaa";
const KEY_B = "gsk_test_rate_limit_recovery_key_bbbbbbbb";

function request(): CanonicalModelRequest {
  return {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Return one short bounded response." }],
    temperature: 0,
    maxOutputTokens: 50,
  };
}

function success(text = "Recovered response."): Response {
  return new Response(JSON.stringify({
    id: "groq-recovery-success",
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function context(
  signal = new AbortController().signal,
  deadlineAtMs?: number,
): ModelCallContext {
  return {
    correlationId: "groq-recovery-test",
    requestIdentity: "request-identity",
    attempt: 0,
    ...(deadlineAtMs === undefined ? {} : { deadlineAtMs }),
    signal,
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ModelProviderError ? error.code : undefined;
}

test("Groq 429 uses the longest valid provider recovery duration before the second bounded attempt", async () => {
  let now = 1_000;
  const waits: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(
    () => now,
    async (delayMs) => {
      waits.push(delayMs);
      now += delayMs;
    },
  );
  let fetches = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => {
      fetches += 1;
      if (fetches === 1) {
        return new Response(JSON.stringify({
          error: { message: "Rate limited; please try again in 0.002s" },
        }), {
          status: 429,
          headers: {
            "retry-after": "0.001",
            "x-ratelimit-reset-tokens": "0.005s",
          },
        });
      }
      assert.ok(now >= 1_005, "second upstream request must not precede the shared deadline");
      return success();
    },
  });
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider);

  const result = await runtime.call(request(), {
    correlationId: "same-provider-recovery",
    idempotencyKey: "same-provider-recovery",
    maxAttempts: 2,
  });

  assert.equal(result.response.output[0]?.type, "text");
  assert.equal(fetches, 2);
  assert.deepEqual(waits, [5]);
  assert.equal(await coordinator.blockedUntil(groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL)), 1_005);
});

test("distinct Groq provider objects with the same credential and model observe the same recovery gate", async () => {
  let now = 5_000;
  const waits: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(
    () => now,
    async (delayMs) => {
      waits.push(delayMs);
      now += delayMs;
    },
  );
  const providerA = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => new Response("{}", {
      status: 429,
      headers: { "x-ratelimit-reset-tokens": "0.010s" },
    }),
  });
  let providerBFetches = 0;
  const providerB = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => {
      providerBFetches += 1;
      assert.ok(now >= 5_010, "sibling provider request escaped the shared recovery gate");
      return success("Sibling recovered.");
    },
  });

  await assert.rejects(providerA.generate(request(), context()), (error) => errorCode(error) === "rate_limit");
  assert.equal(providerBFetches, 0);
  await providerB.generate(request(), context());
  assert.equal(providerBFetches, 1);
  assert.deepEqual(waits, [10]);
});

test("successful Groq zero-token headroom pre-arms the shared recovery gate for the next provider instance", async () => {
  let now = 7_000;
  const waits: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(
    () => now,
    async (delayMs) => {
      waits.push(delayMs);
      now += delayMs;
    },
  );
  const scope = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  const providerA = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({
      id: "groq-zero-headroom",
      model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
      choices: [{ message: { content: "First response." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens": "0.010s",
      },
    }),
  });
  let providerBFetches = 0;
  const providerB = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => {
      providerBFetches += 1;
      assert.ok(now >= 7_010, "next provider request escaped successful-response capacity pacing");
      return success("Second response.");
    },
  });

  await providerA.generate(request(), context());
  assert.equal(await coordinator.blockedUntil(scope), 7_010);
  await providerB.generate(request(), context());

  assert.equal(providerBFetches, 1);
  assert.deepEqual(waits, [10]);
});

test("an unexpected Groq 429 does not start a retry when exact recovery cannot fit the logical deadline", async () => {
  let fetches = 0;
  let waits = 0;
  const coordinator = new MemoryGroqRateLimitCoordinator(
    Date.now,
    async () => { waits += 1; },
  );
  const runtime = new GroqKnowledgeSimplifierModelRuntime(new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return new Response("{}", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    },
  }));

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "doomed-recovery",
      idempotencyKey: "doomed-recovery",
      maxAttempts: 2,
    }),
    (error) => {
      assert.equal(errorCode(error), "rate_limit");
      const diagnostic = (error as ModelProviderError).diagnostic;
      assert.ok(diagnostic);
      assert.equal(diagnostic.attemptsStarted, 1);
      assert.equal(diagnostic.retryCount, 0);
      assert.equal(diagnostic.providerStatus, 429);
      assert.ok(diagnostic.rateLimitWaitMs < 5);
      return true;
    },
  );
  assert.equal(fetches, 1);
  assert.equal(waits, 0);
});

test("Groq recovery windows extend monotonically and different credential scopes remain isolated", async () => {
  const coordinator = new MemoryGroqRateLimitCoordinator();
  const scopeA = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  const scopeB = groqRateLimitScopeId(KEY_B, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  const otherModelScope = groqRateLimitScopeId(KEY_A, "another-groq-model");

  assert.notEqual(scopeA, scopeB);
  assert.notEqual(scopeA, otherModelScope);
  assert.equal(scopeA.includes(KEY_A), false);
  assert.equal(scopeB.includes(KEY_B), false);

  assert.equal(await coordinator.extendBlockedUntil(scopeA, 20_000), 20_000);
  assert.equal(await coordinator.extendBlockedUntil(scopeA, 15_000), 20_000);
  assert.equal(await coordinator.extendBlockedUntil(scopeA, 25_000), 25_000);
  assert.equal(await coordinator.blockedUntil(scopeA), 25_000);
  assert.equal(await coordinator.blockedUntil(scopeB), 0);
  assert.equal(await coordinator.blockedUntil(otherModelScope), 0);
});

test("Groq bounded body fallback establishes recovery when rate-limit headers are absent", async () => {
  let now = 30_000;
  const coordinator = new MemoryGroqRateLimitCoordinator(() => now);
  const scope = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "Limit reached; please try again in 0.007s" },
    }), { status: 429 }),
  });

  await assert.rejects(provider.generate(request(), context()), (error) => errorCode(error) === "rate_limit");
  assert.equal(await coordinator.blockedUntil(scope), 30_007);
});

test("malformed or missing Groq recovery metadata does not create an unbounded shared wait", async () => {
  let now = 10_000;
  const coordinator = new MemoryGroqRateLimitCoordinator(() => now);
  const scope = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), {
      status: 429,
      headers: {
        "retry-after": "not-a-number",
        "x-ratelimit-reset-tokens": "unknown",
      },
    }),
  });

  await assert.rejects(provider.generate(request(), context()), (error) => {
    assert.equal(errorCode(error), "rate_limit");
    assert.equal((error as ModelProviderError).retryable, true);
    return true;
  });
  assert.equal(await coordinator.blockedUntil(scope), 0);
});

test("caller cancellation while waiting behind the Groq recovery gate sends no upstream request", async () => {
  let waiting!: () => void;
  const waitingPromise = new Promise<void>((resolve) => { waiting = resolve; });
  const wait: GroqRateLimitWait = async (_delayMs, signal) => {
    waiting();
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const coordinator = new MemoryGroqRateLimitCoordinator(Date.now, wait);
  const scope = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  await coordinator.extendBlockedUntil(scope, Date.now() + 10_000);
  let fetches = 0;
  const runtime = new GroqKnowledgeSimplifierModelRuntime(new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return success();
    },
  }));
  const controller = new AbortController();

  const pending = runtime.call(request(), {
    correlationId: "cancelled-wait",
    idempotencyKey: "cancelled-wait",
    maxAttempts: 2,
    signal: controller.signal,
  });
  await waitingPromise;
  controller.abort(new Error("test caller cancelled"));

  await assert.rejects(pending, (error) => errorCode(error) === "cancelled");
  assert.equal(fetches, 0);
});

test("shared memory recovery extension beyond the deadline is rejected from inside the active wait", async () => {
  let now = 40_000;
  const deadlineAtMs = 40_100;
  const scope = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  let coordinator!: MemoryGroqRateLimitCoordinator;
  const waits: number[] = [];
  coordinator = new MemoryGroqRateLimitCoordinator(
    () => now,
    async (delayMs) => {
      waits.push(delayMs);
      assert.equal(waits.length, 1, "deadline-aware wait must stop after the concurrent extension");
      await coordinator.extendBlockedUntil(scope, deadlineAtMs + 500);
      now += delayMs;
    },
  );
  await coordinator.extendBlockedUntil(scope, now + 50);

  let fetches = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    now: () => now,
    fetchImpl: async () => {
      fetches += 1;
      return success();
    },
  });

  await assert.rejects(
    provider.generate(request(), context(new AbortController().signal, deadlineAtMs)),
    (error) => {
      assert.equal(errorCode(error), "rate_limit");
      assert.equal((error as ModelProviderError).retryable, false);
      return true;
    },
  );
  assert.deepEqual(waits, [50]);
  assert.equal(fetches, 0);
});

test("known Groq recovery beyond the logical deadline is rejected before waiting or sending upstream", async () => {
  let waits = 0;
  const coordinator = new MemoryGroqRateLimitCoordinator(
    Date.now,
    async () => { waits += 1; },
  );
  const scope = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  await coordinator.extendBlockedUntil(scope, Date.now() + 10_000);
  let fetches = 0;
  const runtime = new GroqKnowledgeSimplifierModelRuntime(new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return success();
    },
  }), 15);

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "deadline-admission",
      idempotencyKey: "deadline-admission",
      maxAttempts: 2,
    }),
    (error) => {
      assert.equal(errorCode(error), "rate_limit");
      assert.equal((error as ModelProviderError).retryable, false);
      return true;
    },
  );
  assert.equal(waits, 0);
  assert.equal(fetches, 0);
});

test("non-retryable Groq output failure remains one provider attempt even when the caller permits two", async () => {
  let fetches = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: new MemoryGroqRateLimitCoordinator(),
    fetchImpl: async () => {
      fetches += 1;
      return new Response("{not-json", { status: 200 });
    },
  });
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider);

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "non-retryable",
      idempotencyKey: "non-retryable",
      maxAttempts: 2,
    }),
    (error) => errorCode(error) === "malformed_response",
  );
  assert.equal(fetches, 1);
});


test("unsupported Groq requests fail before the recovery gate and never send upstream", async () => {
  let waits = 0;
  const coordinator = new MemoryGroqRateLimitCoordinator(
    Date.now,
    async () => { waits += 1; },
  );
  const scope = groqRateLimitScopeId(KEY_A, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  await coordinator.extendBlockedUntil(scope, Date.now() + 10_000);
  let fetches = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY_A,
    rateLimitCoordinator: coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return success();
    },
  });
  const unsupported: CanonicalModelRequest = {
    ...request(),
    model: "different-model",
  };

  await assert.rejects(provider.generate(unsupported, context()), (error) => errorCode(error) === "unsupported_capability");
  assert.equal(waits, 0);
  assert.equal(fetches, 0);
});
