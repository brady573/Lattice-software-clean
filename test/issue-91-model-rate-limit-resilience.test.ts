import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { ModelProviderError } from "../src/model/errors.js";
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
} from "../src/model/groq-knowledge-simplifier.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { ModelSolandraAdvisoryRuntime } from "../src/solandra/advisory.js";
import {
  ModelSolandraActionPreparer,
  type SolandraActionPreparationInput,
} from "../src/solandra/action-preparer.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";

const MODEL = "issue-91-resilience-model";

function cognitionOutput(message: string): string {
  return JSON.stringify({
    mode: "GOVERNED",
    projection: {
      objectiveRelation: "NEW_OBJECTIVE",
      proposedObjective: message,
      requestedHelp: "DECISION",
      relevantContext: [],
      entities: [],
      referents: [],
      constraints: [],
      preferences: [],
      knowledgeNeeds: [],
      materialAmbiguity: null,
      referencedKnowledgeId: null,
      referencedRecommendationId: null,
      referencedOptionId: null,
      referencedIntentProposalId: null,
    },
  });
}

function advisoryClarificationOutput(): string {
  return JSON.stringify({
    status: "NEEDS_CLARIFICATION",
    question: "Which matters more for this choice: lower recurring cost or lower setup effort?",
    reason: "That USER preference materially changes the recommendation.",
  });
}

function groqTextResponse(content: string, requestNumber: number): Response {
  return new Response(JSON.stringify({
    id: `groq-rate-limit-${requestNumber}`,
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    choices: [{
      message: { content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
  }), { status: 200 });
}

function correlationIdFromFetch(init: RequestInit | undefined): string {
  return new Headers(init?.headers).get("x-lattice-correlation-id") ?? "";
}

function currentUserMessageFromFetch(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") return "";
  const payload = JSON.parse(init.body) as {
    messages?: Array<{ role?: string; content?: string }>;
  };
  const content = payload.messages?.at(-1)?.content ?? "";
  return /Current USER message: ([\s\S]*)$/u.exec(content)?.[1]?.trim() ?? "";
}

class DecisionProvider implements ModelProvider {
  readonly kind = "issue-91-rate-limit-fixture";
  readonly calls = new Map<string, number>();
  private readonly allowedAfter = new Map<string, number>();

  constructor(private readonly rateLimitFirstAttempt: boolean) {}

  async generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    const calls = (this.calls.get(context.correlationId) ?? 0) + 1;
    this.calls.set(context.correlationId, calls);

    if (this.rateLimitFirstAttempt && calls === 1) {
      this.allowedAfter.set(context.correlationId, Date.now() + 100);
      throw new ModelProviderError("rate_limit", "simulated provider TPM limit", {
        retryable: true,
        statusCode: 429,
        retryAfterMs: 100,
      });
    }
    const allowedAfter = this.allowedAfter.get(context.correlationId);
    if (allowedAfter !== undefined && Date.now() < allowedAfter) {
      throw new ModelProviderError("rate_limit", "retry occurred before provider wait elapsed", {
        retryable: true,
        statusCode: 429,
      });
    }

    const text = context.correlationId.startsWith("solandra-cognition:")
      ? cognitionOutput(
        request.messages.at(-1)?.content.match(/Current USER message: ([\s\S]*)$/u)?.[1]?.trim()
          ?? "Choose between the available options.",
      )
      : context.correlationId.startsWith("solandra-advisory:")
        ? advisoryClarificationOutput()
        : (() => { throw new Error(`Unexpected model call: ${context.correlationId}`); })();

    return {
      response: {
        id: `response-${context.correlationId}-${calls}`,
        model: request.model,
        output: [{ type: "text", text }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
      },
    };
  }
}

test("Groq TPM responses preserve the provider-directed retry window without exposing the provider body", async () => {
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "test-groq-key-1234567890",
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        code: "rate_limit_exceeded",
        message: "Rate limit reached on tokens per minute. Please try again in 24.7925s.",
        param: "",
        type: "tokens",
      },
    }), { status: 429 }),
  });
  const controller = new AbortController();
  await assert.rejects(
    () => provider.generate({
      model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
      messages: [{ role: "user", content: "Classify this ordinary turn." }],
    }, {
      correlationId: "issue-91-groq-rate-limit",
      requestIdentity: "issue-91-groq-rate-limit-request",
      attempt: 0,
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "rate_limit"
      && error.retryable
      && error.statusCode === 429
      && error.retryAfterMs === 24_793
      && error.message === "Groq Knowledge simplifier route was rate limited.",
  );
});

test("Groq token reset gates the current logical retry without double waiting", async () => {
  let requests = 0;
  const requestTimes: number[] = [];
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "test-groq-key-1234567890",
    fetchImpl: async () => {
      requests += 1;
      requestTimes.push(Date.now());
      if (requests === 1) {
        return new Response(JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message: "Rate limit reached. Please try again in 0.005s.",
            type: "tokens",
          },
        }), {
          status: 429,
          headers: {
            "retry-after": "0.005",
            "x-ratelimit-reset-tokens": "0.08s",
          },
        });
      }
      return groqTextResponse(
        "{\\\"mode\\\":\\\"CONVERSATION\\\",\\\"response\\\":\\\"Recovered.\\\"}",
        requests,
      );
    },
  });
  const runtime = new ModelRuntime(provider, { timeoutMs: 500 });
  const result = await runtime.call({
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Continue the ordinary conversation." }],
  }, {
    correlationId: "issue-91-shared-gate-owner",
    maxAttempts: 2,
  });

  assert.equal(result.response.output[0]?.type, "text");
  assert.equal(requests, 2);
  const retryElapsed = (requestTimes[1] ?? 0) - (requestTimes[0] ?? 0);
  assert.ok(retryElapsed >= 60, `current logical retry bypassed the token-reset gate after only ${retryElapsed}ms`);
  assert.ok(retryElapsed < 180, `current logical retry appears to have waited the recovery window twice (${retryElapsed}ms)`);
});

test("Groq token reset coordinates distinct calls through the shared provider gate", async () => {
  let requests = 0;
  const requestTimes: number[] = [];
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "test-groq-key-1234567890",
    fetchImpl: async () => {
      requests += 1;
      requestTimes.push(Date.now());
      if (requests === 1) {
        return new Response(JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message: "Rate limit reached. Please try again in 0.005s.",
            type: "tokens",
          },
        }), {
          status: 429,
          headers: {
            "retry-after": "0.005",
            "x-ratelimit-reset-tokens": "0.08s",
          },
        });
      }
      return groqTextResponse("Recovered.", requests);
    },
  });
  const request: CanonicalModelRequest = {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "A distinct request must respect the same token window." }],
  };
  const controller = new AbortController();

  await assert.rejects(
    () => provider.generate(request, {
      correlationId: "issue-91-distinct-gate-first",
      requestIdentity: "issue-91-distinct-gate-first",
      attempt: 0,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "rate_limit",
  );

  await provider.generate(request, {
    correlationId: "issue-91-distinct-gate-second",
    requestIdentity: "issue-91-distinct-gate-second",
    attempt: 0,
    signal: controller.signal,
  });

  assert.equal(requests, 2);
  const distinctElapsed = (requestTimes[1] ?? 0) - (requestTimes[0] ?? 0);
  assert.ok(distinctElapsed >= 60, `distinct call bypassed the provider token-reset gate after only ${distinctElapsed}ms`);
  assert.ok(distinctElapsed < 180, `distinct call appears to have waited the recovery window twice (${distinctElapsed}ms)`);
});

test("Groq provider-gate recovery remains caller-cancellable", async () => {
  let requests = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "test-groq-key-1234567890",
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message: "Rate limit reached. Please try again in 0.005s.",
            type: "tokens",
          },
        }), {
          status: 429,
          headers: {
            "retry-after": "0.005",
            "x-ratelimit-reset-tokens": "0.2s",
          },
        });
      }
      return groqTextResponse("Recovered.", requests);
    },
  });
  const request: CanonicalModelRequest = {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Cancel this recovery wait." }],
  };
  const firstController = new AbortController();
  await assert.rejects(
    () => provider.generate(request, {
      correlationId: "issue-91-cancel-gate-first",
      requestIdentity: "issue-91-cancel-gate-first",
      attempt: 0,
      signal: firstController.signal,
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "rate_limit",
  );

  const secondController = new AbortController();
  setTimeout(() => secondController.abort(new Error("caller left")), 20);
  const started = Date.now();
  await assert.rejects(
    () => provider.generate(request, {
      correlationId: "issue-91-cancel-gate-second",
      requestIdentity: "issue-91-cancel-gate-second",
      attempt: 0,
      signal: secondController.signal,
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "cancelled",
  );
  assert.ok(Date.now() - started < 150, "provider recovery wait ignored caller cancellation");
  assert.equal(requests, 1);
});

test("ModelRuntime timeout still bounds a Groq token-reset recovery wait", async () => {
  let requests = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "test-groq-key-1234567890",
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return new Response(JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message: "Rate limit reached. Please try again in 0.005s.",
            type: "tokens",
          },
        }), {
          status: 429,
          headers: {
            "retry-after": "0.005",
            "x-ratelimit-reset-tokens": "0.2s",
          },
        });
      }
      return groqTextResponse("Recovered.", requests);
    },
  });
  const runtime = new ModelRuntime(provider, { timeoutMs: 40 });

  await assert.rejects(
    () => runtime.call({
      model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
      messages: [{ role: "user", content: "Respect the bounded timeout." }],
    }, {
      correlationId: "issue-91-rate-limit-timeout",
      maxAttempts: 2,
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "timeout",
  );
  assert.equal(requests, 1);
});

test("non-retryable model failures are never repeated even when attempts remain", async () => {
  let calls = 0;
  const provider: ModelProvider = {
    kind: "issue-91-non-retryable",
    async generate(): Promise<ModelProviderResult> {
      calls += 1;
      throw new ModelProviderError("invalid_output", "non-retryable fixture failure");
    },
  };
  const runtime = new ModelRuntime(provider, { timeoutMs: 500 });

  await assert.rejects(
    () => runtime.call({
      model: MODEL,
      messages: [{ role: "user", content: "Do not retry this invalid output." }],
    }, {
      correlationId: "issue-91-non-retryable",
      maxAttempts: 3,
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "invalid_output",
  );
  assert.equal(calls, 1);
});

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-91-resilience-user",
} as NodeJS.ProcessEnv);

async function runHeldOutDecision(rateLimitFirstAttempt: boolean) {
  const provider = new DecisionProvider(rateLimitFirstAttempt);
  const runtime = new ModelRuntime(provider, { timeoutMs: 2_000 });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new ModelSolandraCognitiveRuntime(runtime, MODEL),
    solandraAdvisory: new ModelSolandraAdvisoryRuntime(runtime, MODEL),
  });

  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().conversation.id as string;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: rateLimitFirstAttempt ? "held-out-rate-limit" : "held-out-success",
        message: "I can either use a monthly service with a lower setup effort or buy equipment up front with a lower recurring cost. Which approach should I choose?",
      },
    });
    return { response, provider };
  } finally {
    await app.close();
  }
}

test("ordinary decision behavior remains correct when the provider succeeds normally", async () => {
  const { response, provider } = await runHeldOutDecision(false);
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(response.json().status, "NEEDS_CLARIFICATION");
  assert.equal([...provider.calls.values()].reduce((sum, count) => sum + count, 0), 2);
  assert.deepEqual([...provider.calls.values()].sort(), [1, 1]);
});

test("one provider-directed TPM wait no longer turns an ordinary decision into fatal consultation interpretation failure", async () => {
  const { response, provider } = await runHeldOutDecision(true);
  assert.equal(response.statusCode, 202, response.body);
  assert.equal(response.json().status, "NEEDS_CLARIFICATION");
  assert.notEqual(response.json().error, "CONSULTATION_INTERPRETATION_FAILED");
  assert.deepEqual([...provider.calls.values()].sort(), [2, 2]);
});

test("multi-turn Product pressure survives a shorter Retry-After than the shared Groq token reset", async () => {
  let requests = 0;
  const requestTimes: number[] = [];
  const correlations: string[] = [];
  let recoveryDeadline = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: "test-groq-key-1234567890",
    fetchImpl: async (_input, init) => {
      requests += 1;
      const now = Date.now();
      requestTimes.push(now);
      const correlationId = correlationIdFromFetch(init);
      correlations.push(correlationId);

      if (requests === 5) {
        recoveryDeadline = now + 100;
        return new Response(JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message: "Rate limit reached on tokens per minute. Please try again in 0.005s.",
            type: "tokens",
          },
        }), {
          status: 429,
          headers: {
            "retry-after": "0.005",
            "x-ratelimit-reset-tokens": "0.1s",
          },
        });
      }
      if (requests === 6 && now < recoveryDeadline) {
        return new Response(JSON.stringify({
          error: {
            code: "rate_limit_exceeded",
            message: "Retry arrived before the token window recovered.",
            type: "tokens",
          },
        }), { status: 429 });
      }

      if (correlationId.startsWith("solandra-cognition:")) {
        const message = currentUserMessageFromFetch(init);
        const content = message.startsWith("Why does a projector image")
          ? JSON.stringify({
            mode: "CONVERSATION",
            response: "A darker room reduces competing ambient light, so the projected image has more visible contrast.",
          })
          : cognitionOutput(message);
        return groqTextResponse(content, requests);
      }
      if (correlationId.startsWith("solandra-advisory:")) {
        return groqTextResponse(advisoryClarificationOutput(), requests);
      }
      throw new Error(`Unexpected Product-path model correlation: ${correlationId}`);
    },
  });
  const runtime = new ModelRuntime(provider, { timeoutMs: 2_000 });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new ModelSolandraCognitiveRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL),
    solandraAdvisory: new ModelSolandraAdvisoryRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL),
  });

  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().conversation.id as string;

    const knowledge = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "pressure-knowledge",
        message: "Why does a projector image look easier to see in a darker room?",
      },
    });
    assert.equal(knowledge.statusCode, 200, knowledge.body);
    assert.equal(knowledge.json().status, "CONVERSATION_COMPLETED");

    const setup = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "pressure-setup",
        message: "I can carry workshop supplies in a folding cart or a shoulder bag. The cart is easier on my back, but the bag is faster on stairs, and I have not said which matters more.",
      },
    });
    assert.equal(setup.statusCode, 202, setup.body);
    assert.equal(setup.json().status, "NEEDS_CLARIFICATION");

    const followup = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: {
        turnId: "pressure-followup",
        message: "Which one is better?",
      },
    });
    assert.equal(followup.statusCode, 202, followup.body);
    assert.equal(followup.json().status, "NEEDS_CLARIFICATION");
    assert.notEqual(followup.json().error, "CONSULTATION_INTERPRETATION_FAILED");
    assert.notEqual(followup.json().error, "SOLANDRA_ADVISORY_FAILED");

    assert.equal(requests, 6);
    assert.deepEqual(
      correlations.map((value) => value.split(":")[0]),
      [
        "solandra-cognition",
        "solandra-cognition",
        "solandra-advisory",
        "solandra-cognition",
        "solandra-advisory",
        "solandra-advisory",
      ],
    );
    const retryElapsed = (requestTimes[5] ?? 0) - (requestTimes[4] ?? 0);
    assert.ok(retryElapsed >= 75, `Product-path advisory retry bypassed token recovery after only ${retryElapsed}ms`);
    assert.ok(retryElapsed < 220, `Product-path advisory retry appears to have double-waited (${retryElapsed}ms)`);
  } finally {
    await app.close();
  }
});


class ActionPreparationProvider implements ModelProvider {
  readonly kind = "issue-91-action-rate-limit-fixture";
  readonly calls = new Map<string, number>();
  private readonly allowedAfter = new Map<string, number>();

  async generate(
    request: CanonicalModelRequest,
    context: ModelCallContext,
  ): Promise<ModelProviderResult> {
    const calls = (this.calls.get(context.correlationId) ?? 0) + 1;
    this.calls.set(context.correlationId, calls);
    if (calls === 1) {
      this.allowedAfter.set(context.correlationId, Date.now() + 25);
      throw new ModelProviderError("rate_limit", "simulated action-preparation TPM limit", {
        retryable: true,
        statusCode: 429,
        retryAfterMs: 25,
      });
    }
    const allowedAfter = this.allowedAfter.get(context.correlationId);
    if (allowedAfter !== undefined && Date.now() < allowedAfter) {
      throw new ModelProviderError("rate_limit", "action-preparation retry occurred before provider wait elapsed", {
        retryable: true,
        statusCode: 429,
      });
    }

    const text = context.correlationId.startsWith("solandra-action-prepare:")
      ? JSON.stringify({
        status: "PREPARED",
        body: "Hello, I recommend the RAM-first option. Please approve it if you agree.",
        basis: [],
      })
      : context.correlationId.startsWith("solandra-action-ground:")
        ? JSON.stringify({
          status: "GROUNDED",
          unsupportedExternalPremises: [],
          materialUncertaintyPreserved: true,
          authorityBoundaryPreserved: true,
        })
        : (() => { throw new Error(`Unexpected action-preparation model call: ${context.correlationId}`); })();

    return {
      response: {
        id: `action-response-${context.correlationId}-${calls}`,
        model: request.model,
        output: [{ type: "text", text }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
      },
    };
  }
}

const actionInput: SolandraActionPreparationInput = {
  conversationId: "issue-91-action-resilience",
  runId: "11111111-1111-4111-8111-111111111111",
  intentVersionId: "issue-91-action-intent",
  userMessageId: "issue-91-action-message",
  userMessage: "Draft a short message recommending the RAM-first option and asking for approval. Do not send it.",
  authoritativeObjective: "Choose the better work setup for the USER's stated priorities.",
  knowledge: [],
};

test("action preparation generation and grounding use the same bounded retry resilience", async () => {
  const provider = new ActionPreparationProvider();
  const preparer = new ModelSolandraActionPreparer(
    new ModelRuntime(provider, { timeoutMs: 2_000 }),
    MODEL,
  );
  const result = await preparer.prepare(actionInput);

  assert.equal(result.result.status, "PREPARED");
  assert.deepEqual([...provider.calls.values()].sort(), [2, 2]);
});
