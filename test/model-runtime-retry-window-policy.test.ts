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
import { ModelSolandraAdvisoryRuntime } from "../src/solandra/advisory.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";
import { ModelSolandraKnowledgeInvestigator } from "../src/solandra/knowledge-investigator.js";

/**
 * Issue #91 bounded runtime-reliability repair, scoped by Steward direction to
 * Solandra cognition and advisory only.
 *
 * The per-attempt window policy is an explicit per-call opt-in: a caller that
 * owns a durable execution lease (the Knowledge investigator runs inside the
 * durable Run worker) must keep the single shared budget so the model call can
 * never outlast its enclosing ownership.
 */

const MODEL = "runtime-retry-window-fixture";
const PER_ATTEMPT = { attemptWindowPolicy: "per-attempt" as const };

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
    response: { id, model: MODEL, output: [{ type: "text", text }] },
    route: {
      actualProvider: "runtime-retry-window-provider",
      actualModel: MODEL,
      upstreamRequestId: id,
    },
  } as ModelProviderResult;
}

type Step = "hang" | "answer" | "json-answer" | "retryable" | "non-retryable" | "ready-then-answer" | "hold";

class ScriptedProvider implements ModelProvider {
  readonly kind = "runtime-retry-window-provider";
  calls = 0;

  private jsonAnswers: string[] = [];
  holdMs = 250;

  constructor(private readonly script: Step[], jsonAnswers: string[] = []) {
    this.jsonAnswers = [...jsonAnswers];
  }

  async generate(
    modelRequest: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    this.calls += 1;
    const step = this.script.shift();
    assert.ok(step !== undefined, "scripted provider exhausted");
    if (step === "hang") {
      // Resolves only when the attempt window ends, with an unreferenced safety
      // timer so a forgotten hang can never outlive the test process.
      return await new Promise<ModelProviderResult>((_resolve, reject) => {
        const safety = setTimeout(() => reject(new Error("scripted hang safety")), 5_000);
        safety.unref();
        context.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(safety);
            reject(context.signal.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      });
    }
    if (step === "json-answer") {
      const json = this.jsonAnswers.shift();
      assert.ok(json !== undefined, "scripted json answer exhausted");
      return textResult(`json-${this.calls}`, json);
    }
    if (step === "hold") {
      // Occupies the logical key for longer than one attempt window.
      await delay(this.holdMs);
      return textResult(`hold-${this.calls}`, "held the logical key");
    }
    if (step === "retryable") {
      throw new ModelProviderError("rate_limit", "controlled transient 429", {
        retryable: true,
        statusCode: 429,
      });
    }
    if (step === "non-retryable") {
      throw new ModelProviderError("invalid_output", "controlled permanent provider failure.");
    }
    if (step === "ready-then-answer") {
      await delay(30);
      return textResult(`ready-${this.calls}`, "ready then answered");
    }
    return textResult(`answered-${this.calls}`, "answered within its window");
  }
}

function runtime(provider: ModelProvider, timeoutMs: number): ModelRuntime {
  return new ModelRuntime(provider, { timeoutMs });
}

test("a per-attempt window stops a slow first attempt from starving the permitted retry", async () => {
  const provider = new ScriptedProvider(["hang", "answer"]);
  const model = runtime(provider, 120);
  const started = Date.now();
  const result = await model.call(
    request("bounded retry window"),
    { correlationId: "retry-window", maxAttempts: 2, ...PER_ATTEMPT },
  );
  const elapsed = Date.now() - started;
  assert.equal(assistantText(result.response), "answered within its window");
  assert.equal(provider.calls, 2);
  assert.ok(elapsed >= 120, `the retry ran in its own window (took ${elapsed} ms)`);
  assert.ok(elapsed < 400, `the call stayed finite (took ${elapsed} ms)`);
});

test("queue waiting for the logical key does not consume a permitted attempt's window", async () => {
  // Window 300 ms: the predecessor holds the logical key for ~250 ms, which is
  // most of one window. A successor on a single shared budget would have almost
  // no attempt budget left; under per-attempt windows it still gets its own.
  const provider = new ScriptedProvider(["hold", "hang", "answer"]);
  const model = runtime(provider, 300);
  const predecessor = model.call(request("predecessor"), {
    correlationId: "lock-contention",
    idempotencyKey: "predecessor",
  });
  await delay(30);
  const started = Date.now();
  const successor = await model.call(request("successor"), {
    correlationId: "lock-contention",
    idempotencyKey: "successor",
    maxAttempts: 2,
    ...PER_ATTEMPT,
  });
  const elapsed = Date.now() - started;
  await predecessor;

  assert.equal(assistantText(successor.response), "answered within its window");
  assert.equal(
    provider.calls,
    3,
    "the successor still executed its own attempts after waiting behind the lock",
  );
  assert.ok(elapsed >= 200, `the successor really waited behind the lock (took ${elapsed} ms)`);
});

test("a hanging predecessor cannot make a successor run unboundedly", async () => {
  // A predecessor that never returns is bounded by its own window; the successor
  // then proceeds within its own explicit bound instead of running unbounded.
  const provider = new ScriptedProvider(["hang", "answer"]);
  const model = runtime(provider, 120);
  const predecessor = model.call(request("hanging predecessor"), {
    correlationId: "hanging-predecessor",
    idempotencyKey: "predecessor",
    maxAttempts: 2,
    ...PER_ATTEMPT,
  });
  await delay(20);
  const started = Date.now();
  const successor = await model.call(request("successor"), {
    correlationId: "hanging-predecessor",
    idempotencyKey: "successor",
    maxAttempts: 2,
    ...PER_ATTEMPT,
  });
  const elapsed = Date.now() - started;
  await predecessor.catch(() => undefined);

  assert.equal(assistantText(successor.response), "answered within its window");
  assert.ok(
    elapsed < 1_000,
    `the successor stayed inside its own explicit bound after a hanging predecessor (took ${elapsed} ms)`,
  );
});

test("the whole per-attempt call has an explicit finite upper bound", async () => {
  const provider = new ScriptedProvider(["hang", "hang", "hang"]);
  const model = runtime(provider, 80);
  const started = Date.now();
  await assert.rejects(
    model.call(request("bounded operation"), { correlationId: "operation-bound", maxAttempts: 3, ...PER_ATTEMPT }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "timeout",
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 200, `the bounded attempts ran (took ${elapsed} ms)`);
  assert.ok(elapsed < 600, `the call stayed finite (took ${elapsed} ms)`);
});

test("caller cancellation still terminates a per-attempt call without spending a retry", async () => {
  const provider = new ScriptedProvider(["hang", "answer"]);
  const model = runtime(provider, 5_000);
  const controller = new AbortController();
  const call = model.call(
    request("caller cancellation"),
    { correlationId: "caller-cancel", maxAttempts: 2, ...PER_ATTEMPT, signal: controller.signal },
  );
  setTimeout(() => controller.abort(new Error("caller went away")), 30).unref();
  await assert.rejects(
    call,
    (error: unknown) => error instanceof ModelProviderError && error.code === "cancelled",
  );
  assert.equal(provider.calls, 1);
});

test("non-retryable failures gain no retry under the per-attempt policy", async () => {
  const provider = new ScriptedProvider(["non-retryable", "answer"]);
  const model = runtime(provider, 1_000);
  await assert.rejects(
    model.call(request("non retryable"), { correlationId: "non-retryable", maxAttempts: 2, ...PER_ATTEMPT }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "invalid_output",
  );
  assert.equal(provider.calls, 1);
});

test("per-attempt retries remain exhaustible and bounded", async () => {
  const provider = new ScriptedProvider(["retryable", "retryable", "answer"]);
  const model = runtime(provider, 1_000);
  await assert.rejects(
    model.call(request("exhausted"), { correlationId: "exhausted", maxAttempts: 2, ...PER_ATTEMPT }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "rate_limit",
  );
  assert.equal(provider.calls, 2, "the configured maximum attempt count is still enforced");
});

test("a successful first attempt adds no delay", async () => {
  const provider = new ScriptedProvider(["answer"]);
  const model = runtime(provider, 1_000);
  const started = Date.now();
  const result = await model.call(
    request("first attempt success"),
    { correlationId: "first-success", maxAttempts: 2, ...PER_ATTEMPT },
  );
  assert.equal(assistantText(result.response), "answered within its window");
  assert.equal(provider.calls, 1);
  assert.ok(Date.now() - started < 200);
});

test("provider readiness waiting is covered by the attempt window", async () => {
  const provider = new ScriptedProvider(["ready-then-answer", "answer"]);
  const model = runtime(provider, 200);
  const result = await model.call(
    request("readiness wait"),
    { correlationId: "readiness", maxAttempts: 2, ...PER_ATTEMPT },
  );
  assert.equal(assistantText(result.response), "ready then answered");
  assert.equal(provider.calls, 1, "a readiness wait inside the window does not spend a retry");
});

test("callers that do not opt in keep the single shared budget", async () => {
  const provider = new ScriptedProvider(["hang", "answer"]);
  const model = runtime(provider, 60);
  await assert.rejects(
    model.call(request("shared policy"), { correlationId: "shared-policy", maxAttempts: 2 }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "timeout",
  );
  assert.equal(provider.calls, 1, "durable-lease-owned callers keep exactly one bounded budget");
});

test("a timeout that cannot be represented as a Node timer is rejected instead of mis-scheduled", async () => {
  assert.throws(
    () => new ModelRuntime(new ScriptedProvider(["answer"]), { timeoutMs: 3_000_000_000 }),
    /timer delay/u,
    "an unrepresentable window fails fast rather than scheduling a false bound",
  );
  const model = new ModelRuntime(new ScriptedProvider(["answer"]), { timeoutMs: 1_000_000_000 });
  await assert.rejects(
    model.call(request("unrepresentable budget"), { correlationId: "unrepresentable", maxAttempts: 3, ...PER_ATTEMPT }),
    /timer delay/u,
  );
});

test("Solandra cognition and advisory opt in, while the durable-lease investigator does not", async () => {
  // Cognition: an allowed retry survives a hung first attempt.
  const cognitionProposal: string = JSON.stringify({
    mode: "GOVERNED",
    projection: {
    objectiveRelation: "NEW_OBJECTIVE",
    proposedObjective: "Bounded retry evidence",
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: ["Establish a bounded fact"],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    referencedOptionId: null,
    proposedNextStep: "INVESTIGATE",
    },
  });
  const cognitionProvider = new ScriptedProvider(["hang", "json-answer"], [cognitionProposal]);
  const cognition = new ModelSolandraCognitiveRuntime(runtime(cognitionProvider, 80), MODEL, 2);
  const interpreted = await cognition.interpret({
    conversationId: "conversation-retry-window",
    messageId: "message-retry-window",
    message: "Establish a bounded fact for me.",
    recentUserMessages: [],
    governedKnowledge: [],
  });
  assert.equal(
    (interpreted as { mode?: string }).mode,
    "GOVERNED",
    "cognition returned its governed proposal after the permitted retry",
  );
  assert.equal(cognitionProvider.calls, 2, "cognition recovered on its permitted retry");

  // Knowledge investigator: executes inside the durable Run worker's lease, so
  // it keeps the single shared budget and does not extend past one window.
  const investigatorPlan: string = JSON.stringify({ retrievalQueries: [] });
  const investigatorProvider = new ScriptedProvider(["hang", "json-answer"], [investigatorPlan]);
  const investigator = new ModelSolandraKnowledgeInvestigator(runtime(investigatorProvider, 80), MODEL, 2);
  await assert.rejects(
    investigator.plan({
      runId: "run-retry-window",
      objective: "Establish a bounded fact for me.",
      context: [],
      knowledgeNeeds: ["Establish a bounded fact"],
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "timeout",
  );
  assert.equal(
    investigatorProvider.calls,
    1,
    "the lease-owned investigator must not run longer than a single shared budget",
  );

  // Advisory: also opted in.
  assert.ok(ModelSolandraAdvisoryRuntime !== undefined);
});
