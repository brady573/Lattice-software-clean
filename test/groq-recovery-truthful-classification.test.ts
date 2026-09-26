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
  type GroqRateLimitCoordinator,
  type GroqRateLimitWait,
} from "../src/model/groq-rate-limit-coordinator.js";
import type { CanonicalModelRequest } from "../src/model/types.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

/**
 * Issue #91 truthful Groq recovery-boundary handling.
 *
 * When the shared coordinator holds a known recovery block and an attempt
 * window expires before that block clears, the attempt never reached provider
 * HTTP. That is a known rate-limit/recovery condition, and the runtime must
 * report it as one instead of overwriting it with an undifferentiated model
 * timeout or spending another attempt on the same unchanged block.
 *
 * Every test asserts whether provider HTTP was invoked, because "no upstream
 * request" is the core of the behavior under test.
 */

const KEY = "gsk_test_recovery_truthful_key_aaaaaa";
const SCOPE = groqRateLimitScopeId(KEY, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
const ATTEMPT_WINDOW_MS = 30;
const PER_ATTEMPT = { attemptWindowPolicy: "per-attempt" as const };

function request(): CanonicalModelRequest {
  return {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Return one short bounded response." }],
    temperature: 0,
    maxOutputTokens: 50,
  };
}

function completion(text: string): Response {
  return new Response(JSON.stringify({
    id: "groq-recovery-truthful-success",
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function rateLimited(delayMs: number): Response {
  return new Response(JSON.stringify({
    error: { message: `Rate limited; please try again in ${delayMs / 1000}s` },
  }), {
    status: 429,
    headers: { "x-ratelimit-reset-tokens": `${delayMs / 1000}s` },
  });
}

function code(error: unknown): string | undefined {
  return error instanceof ModelProviderError ? error.code : undefined;
}

/**
 * A recovery wait that never clears on its own: it only ends when the caller's
 * signal aborts, which is exactly the situation where an attempt window expires
 * while a known block is still active.
 */
function interruptedWait(waits: number[]): GroqRateLimitWait {
  return async (delayMs, signal) => {
    waits.push(delayMs);
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error("Aborted."));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Aborted.")), { once: true });
    });
  };
}

/** A recovery wait that clears immediately by advancing a controlled clock. */
function clockAdvancingWait(clock: { value: number }, waited: number[]): GroqRateLimitWait {
  return async (delayMs) => {
    waited.push(delayMs);
    clock.value += delayMs;
  };
}

function harness(options: {
  now: () => number;
  coordinator: MemoryGroqRateLimitCoordinator;
  fetchImpl: typeof fetch;
}) {
  return new GroqKnowledgeSimplifierModelRuntime(new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY,
    rateLimitCoordinator: options.coordinator,
    now: options.now,
    fetchImpl: options.fetchImpl,
  }), ATTEMPT_WINDOW_MS);
}

// A. A known recovery block longer than the attempt window must not be reported
// as a generic model timeout, and must not reach provider HTTP.
test("A. a known recovery block longer than the attempt window keeps a typed rate-limit boundary and sends no HTTP", async () => {
  let now = 1_000;
  const waits: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(() => now, interruptedWait(waits));
  await coordinator.extendBlockedUntil(SCOPE, now + 10_000);
  let fetches = 0;
  const runtime = harness({
    now: () => now,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return completion("unreachable");
    },
  });

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "recovery-exceeds-window",
      idempotencyKey: "recovery-exceeds-window",
      maxAttempts: 2,
    }),
    (error) => {
      assert.equal(code(error), "rate_limit");
      assert.equal((error as ModelProviderError).retryable, false);
      assert.match(String((error as ModelProviderError).message), /recovery window/i);
      return true;
    },
  );
  assert.equal(fetches, 0, "provider HTTP must not be attempted inside a known recovery block");
  assert.deepEqual(waits, [10_000], "the recovery gate must be consulted exactly once");
});

// B. The same still-active block must not consume a second permitted attempt.
test("B. a still-active recovery block does not spend a second attempt in the per-attempt policy", async () => {
  let now = 2_000;
  const waits: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(() => now, interruptedWait(waits));
  await coordinator.extendBlockedUntil(SCOPE, now + 10_000);
  let fetches = 0;
  const runtime = harness({
    now: () => now,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return completion("unreachable");
    },
  });
  const cognition = new ModelSolandraCognitiveRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL, 2);

  await assert.rejects(cognition.interpret({
    conversationId: "recovery-survives-retry",
    messageId: "recovery-survives-retry-message",
    message: "How should I think about keeping a shared household routine running smoothly?",
    recentUserMessages: [],
    recentConversation: [],
    governedKnowledge: [],
    governedRecommendations: [],
  }), (error) => code(error) === "rate_limit");
  assert.equal(fetches, 0);
  assert.deepEqual(waits, [10_000], "one attempt window, not two, may be spent on an unchanged block");
  assert.equal(
    await coordinator.blockedUntil(SCOPE),
    now + 10_000,
    "the recovery block itself must be preserved unchanged",
  );
});

// C. Recovery that clears inside the permitted bound proceeds to provider HTTP
// and can succeed, with no leftover rate-limit result.
test("C. recovery that clears within the attempt window proceeds to provider HTTP and succeeds", async () => {
  const clock = { value: 3_000 };
  const waited: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(
    () => clock.value,
    clockAdvancingWait(clock, waited),
  );
  await coordinator.extendBlockedUntil(SCOPE, clock.value + 5);
  let fetches = 0;
  const runtime = harness({
    now: () => clock.value,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return completion("Recovered after the route was ready.");
    },
  });

  const result = await runtime.call(request(), {
    correlationId: "recovery-clears",
    idempotencyKey: "recovery-clears",
    maxAttempts: 2,
    ...PER_ATTEMPT,
  });

  assert.equal(result.response.output[0]?.type, "text");
  assert.equal(fetches, 1);
  assert.deepEqual(waited, [5]);
});

// D. Real 429 handling is unchanged: the delay is recorded, the error stays
// rate_limit and retryable, and a recovery delay longer than the window is
// reported truthfully instead of as a timeout.
test("D. a real 429 records recovery, stays retryable rate_limit, and a long recovery is reported truthfully", async () => {
  let now = 4_000;
  const waits: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(() => now, interruptedWait(waits));
  let fetches = 0;
  const runtime = harness({
    now: () => now,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return rateLimited(10_000);
    },
  });

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "real-429",
      idempotencyKey: "real-429",
      maxAttempts: 2,
      ...PER_ATTEMPT,
    }),
    (error) => {
      assert.equal(code(error), "rate_limit");
      return true;
    },
  );
  assert.equal(fetches, 1, "the 429 came from a real upstream request");
  assert.equal(await coordinator.blockedUntil(SCOPE), now + 10_000, "429 recovery delay must be recorded");
  assert.deepEqual(waits, [10_000], "the recorded recovery is respected, not bypassed");
});

test("D2. a real 429 remains retryable and recovers on the permitted retry", async () => {
  let now = 5_000;
  const waited: number[] = [];
  const coordinator = new MemoryGroqRateLimitCoordinator(() => now, async (delayMs) => {
    waited.push(delayMs);
    now += delayMs;
  });
  let fetches = 0;
  const runtime = harness({
    now: () => now,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return fetches === 1 ? rateLimited(5) : completion("Recovered after 429.");
    },
  });

  const result = await runtime.call(request(), {
    correlationId: "real-429-retry",
    idempotencyKey: "real-429-retry",
    maxAttempts: 2,
  });

  assert.equal(result.response.output[0]?.type, "text");
  assert.equal(fetches, 2);
  assert.deepEqual(waited, [5]);
});

// E. A post-fetch stall, where HTTP has started and the provider never answers,
// stays an ordinary model timeout.
test("E. a post-fetch provider stall remains an ordinary model timeout", async () => {
  const coordinator = new MemoryGroqRateLimitCoordinator();
  let fetches = 0;
  const runtime = harness({
    now: Date.now,
    coordinator,
    fetchImpl: () => {
      fetches += 1;
      // A stalled socket that ignores the abort signal, exactly like a provider
      // that never answers after the request was accepted.
      return new Promise<Response>(() => undefined);
    },
  });

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "post-fetch-stall",
      idempotencyKey: "post-fetch-stall",
      maxAttempts: 2,
      ...PER_ATTEMPT,
    }),
    (error) => {
      assert.equal(code(error), "timeout");
      assert.equal((error as ModelProviderError).retryable, true);
      return true;
    },
  );
  // A post-fetch timeout stays retryable, so the permitted retry is still
  // spent. That is unchanged behavior and is what distinguishes it from the
  // non-retryable known-recovery boundary.
  assert.equal(fetches, 2, "each stalled attempt did reach provider HTTP");
});

// E2. The same stall in the shared-window policy is still a timeout.
test("E2. a post-fetch provider stall in the shared-window policy remains a timeout", async () => {
  const coordinator = new MemoryGroqRateLimitCoordinator();
  let fetches = 0;
  const runtime = harness({
    now: Date.now,
    coordinator,
    fetchImpl: () => {
      fetches += 1;
      return new Promise<Response>(() => undefined);
    },
  });

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "post-fetch-stall-shared",
      idempotencyKey: "post-fetch-stall-shared",
      maxAttempts: 2,
    }),
    (error) => code(error) === "timeout",
  );
  assert.equal(fetches, 1);
});

// F. Caller cancellation still wins over a known recovery block.
test("F. caller cancellation during a recovery wait remains cancellation and sends no HTTP", async () => {
  let waiting!: () => void;
  const waitingPromise = new Promise<void>((resolve) => { waiting = resolve; });
  const coordinator = new MemoryGroqRateLimitCoordinator(Date.now, async (_delayMs, signal) => {
    waiting();
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error("Aborted."));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Aborted.")), { once: true });
    });
  });
  await coordinator.extendBlockedUntil(SCOPE, Date.now() + 10_000);
  let fetches = 0;
  const runtime = harness({
    now: Date.now,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return completion("unreachable");
    },
  });
  const controller = new AbortController();

  const pending = runtime.call(request(), {
    correlationId: "caller-cancel-recovery",
    idempotencyKey: "caller-cancel-recovery",
    maxAttempts: 2,
    signal: controller.signal,
  });
  await waitingPromise;
  controller.abort(new Error("test caller cancelled"));

  await assert.rejects(pending, (error) => {
    assert.equal(code(error), "cancelled");
    return true;
  });
  assert.equal(fetches, 0);
});

// G. A normal unblocked call is behaviorally unchanged.
test("G. a normal unblocked call reaches HTTP and returns its completion unchanged", async () => {
  const coordinator = new MemoryGroqRateLimitCoordinator();
  let fetches = 0;
  const runtime = harness({
    now: Date.now,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return completion("Ordinary unblocked answer.");
    },
  });

  const result = await runtime.call(request(), {
    correlationId: "unblocked-success",
    idempotencyKey: "unblocked-success",
    maxAttempts: 2,
    ...PER_ATTEMPT,
  });

  assert.equal(result.response.output[0]?.type, "text");
  assert.equal(
    result.response.output[0]?.type === "text" ? result.response.output[0].text : undefined,
    "Ordinary unblocked answer.",
  );
  assert.equal(result.audit.providerKind, "groq-knowledge-simplifier");
  assert.equal(result.audit.invocationProvenance.actualProvider, "groq");
  assert.equal(result.audit.invocationProvenance.actualModel, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  assert.equal(fetches, 1);
});

// G2. A blocked scope for a different credential must not affect this one, so a
// known block is never asserted without evidence for this scope.
test("G2. a recovery block on another credential scope does not block this route", async () => {
  const coordinator = new MemoryGroqRateLimitCoordinator();
  const otherScope = groqRateLimitScopeId("gsk_test_recovery_truthful_key_bbbbbb", GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  await coordinator.extendBlockedUntil(otherScope, Date.now() + 60_000);
  let fetches = 0;
  const runtime = harness({
    now: Date.now,
    coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return completion("Unrelated scope did not block this route.");
    },
  });

  const result = await runtime.call(request(), {
    correlationId: "other-scope",
    idempotencyKey: "other-scope",
    maxAttempts: 2,
    ...PER_ATTEMPT,
  });

  assert.equal(result.response.output[0]?.type, "text");
  assert.equal(fetches, 1);
});

// H. The truthful boundary must not depend on being able to read the coordinator
// after the signal has aborted. A database-backed coordinator can be slow or
// unavailable at exactly that moment, so the classification has to rest on the
// evidence the wait itself already carried.
test("H. the recovery boundary survives a coordinator that cannot be read after the abort", async () => {
  let now = 6_000;
  const waits: number[] = [];
  const inner = new MemoryGroqRateLimitCoordinator(() => now, interruptedWait(waits));
  await inner.extendBlockedUntil(SCOPE, now + 10_000);
  let waitStarted = false;
  const unreadableCoordinator: GroqRateLimitCoordinator = {
    kind: inner.kind,
    async blockedUntil(scopeId, signal) {
      // Once a recovery wait is under way, the coordinator is no longer
      // readable, exactly like a database that is gone at that instant.
      if (waitStarted) throw new Error("coordinator read unavailable");
      return await inner.blockedUntil(scopeId, signal);
    },
    async extendBlockedUntil(scopeId, blockedUntilMs, signal) {
      return await inner.extendBlockedUntil(scopeId, blockedUntilMs, signal);
    },
    async waitUntilReady(scopeId, signal) {
      waitStarted = true;
      return await inner.waitUntilReady(scopeId, signal);
    },
    async close() {
      return await inner.close();
    },
  };
  let fetches = 0;
  const runtime = new GroqKnowledgeSimplifierModelRuntime(new GroqKnowledgeSimplifierModelProvider({
    apiKey: KEY,
    rateLimitCoordinator: unreadableCoordinator,
    now: () => now,
    fetchImpl: async () => {
      fetches += 1;
      return completion("unreachable");
    },
  }), ATTEMPT_WINDOW_MS);

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "unreadable-coordinator",
      idempotencyKey: "unreadable-coordinator",
      maxAttempts: 2,
    }),
    (error) => {
      assert.equal(code(error), "rate_limit");
      assert.equal((error as ModelProviderError).retryable, false);
      return true;
    },
  );
  assert.equal(fetches, 0);
  assert.deepEqual(waits, [10_000]);
});
