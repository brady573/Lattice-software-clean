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

test("Groq token reset coordinates distinct calls after rate pressure is observed", async () => {
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
            "x-ratelimit-reset-tokens": "0.03s",
          },
        });
      }
      return new Response(JSON.stringify({
        id: `groq-shared-recovery-${requests}`,
        model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
        choices: [{
          message: { content: "{\\\"mode\\\":\\\"CONVERSATION\\\",\\\"response\\\":\\\"Recovered.\\\"}" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }), { status: 200 });
    },
  });
  const request: CanonicalModelRequest = {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Continue the ordinary conversation." }],
  };
  const controller = new AbortController();

  await assert.rejects(
    () => provider.generate(request, {
      correlationId: "issue-91-shared-gate-first",
      requestIdentity: "issue-91-shared-gate-first-request",
      attempt: 0,
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof ModelProviderError
      && error.code === "rate_limit"
      && error.retryAfterMs === 30,
  );

  const started = Date.now();
  await provider.generate(request, {
    correlationId: "issue-91-shared-gate-second",
    requestIdentity: "issue-91-shared-gate-second-request",
    attempt: 0,
    signal: controller.signal,
  });
  const elapsed = Date.now() - started;

  assert.equal(requests, 2);
  assert.ok(elapsed >= 20, `distinct call bypassed provider token-reset gate after only ${elapsed}ms`);
  assert.ok((requestTimes[1] ?? 0) - (requestTimes[0] ?? 0) >= 20);
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
