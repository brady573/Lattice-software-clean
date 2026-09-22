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
} from "../src/model/groq-rate-limit-coordinator.js";
import type { CanonicalModelRequest } from "../src/model/types.js";
import {
  ModelSolandraCognitiveRuntime,
} from "../src/solandra/cognition.js";

const DIAGNOSTIC_KEY = "diagnostic-key-material-not-a-secret-1234567890";

function request(): CanonicalModelRequest {
  return {
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    messages: [{ role: "user", content: "Return a short diagnostic fixture response." }],
    temperature: 0,
    maxOutputTokens: 50,
  };
}

function success(): Response {
  return new Response(JSON.stringify({
    id: "diagnostic-success",
    model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
  }), { status: 200 });
}

test("model diagnostic rejects a known Groq recovery window that cannot fit the logical deadline", async () => {
  const coordinator = new MemoryGroqRateLimitCoordinator();
  const scope = groqRateLimitScopeId(DIAGNOSTIC_KEY, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  await coordinator.extendBlockedUntil(scope, Date.now() + 500);

  let fetches = 0;
  const provider = new GroqKnowledgeSimplifierModelProvider({
    apiKey: DIAGNOSTIC_KEY,
    rateLimitCoordinator: coordinator,
    fetchImpl: async () => {
      fetches += 1;
      return success();
    },
  });
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider, 50);

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "diagnostic-preexisting-recovery",
      idempotencyKey: "diagnostic-preexisting-recovery",
      maxAttempts: 2,
    }),
    (error) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.code, "rate_limit");
      assert.equal(error.retryable, false);
      const diagnostic = error.diagnostic;
      assert.ok(diagnostic);
      assert.equal(diagnostic.attemptsStarted, 1);
      assert.equal(diagnostic.retryCount, 0);
      assert.equal(diagnostic.providerStatus, null);
      assert.equal(diagnostic.maxOutputTokens, 50);
      assert.ok(diagnostic.rateLimitWaitMs < 5);
      return true;
    },
  );
  assert.equal(fetches, 0);
});

test("model diagnostic preserves 429 capacity metadata when exact recovery cannot fit the logical deadline", async () => {
  const coordinator = new MemoryGroqRateLimitCoordinator();
  let fetches = 0;
  const runtime = new GroqKnowledgeSimplifierModelRuntime(
    new GroqKnowledgeSimplifierModelProvider({
      apiKey: DIAGNOSTIC_KEY,
      rateLimitCoordinator: coordinator,
      fetchImpl: async () => {
        fetches += 1;
        if (fetches > 1) return success();
        return new Response(JSON.stringify({ error: { message: "fixture throttled" } }), {
          status: 429,
          headers: {
            "retry-after": "0.250",
            "x-ratelimit-limit-tokens": "8000",
            "x-ratelimit-remaining-tokens": "0",
            "x-ratelimit-reset-tokens": "0.250s",
          },
        });
      },
    }),
    70,
  );

  await assert.rejects(
    runtime.call(request(), {
      correlationId: "diagnostic-429-recovery",
      idempotencyKey: "diagnostic-429-recovery",
      maxAttempts: 2,
    }),
    (error) => {
      assert.ok(error instanceof ModelProviderError);
      assert.equal(error.code, "rate_limit");
      const diagnostic = error.diagnostic;
      assert.ok(diagnostic);
      assert.equal(diagnostic.timeoutPhase, "PROVIDER_RESPONSE");
      assert.equal(diagnostic.attemptsStarted, 1);
      assert.equal(diagnostic.retryCount, 0);
      assert.equal(diagnostic.providerStatus, 429);
      assert.equal(diagnostic.rateLimitRecoveryMs, 250);
      assert.equal(diagnostic.rateLimitLimitTokens, 8_000);
      assert.equal(diagnostic.rateLimitRemainingTokens, 0);
      assert.equal(diagnostic.rateLimitResetTokensMs, 250);
      assert.equal(diagnostic.maxOutputTokens, 50);
      assert.ok(diagnostic.requestBytes > 0);
      assert.ok(diagnostic.rateLimitWaitMs < 5);
      const serialized = JSON.stringify(diagnostic);
      assert.equal(serialized.includes(DIAGNOSTIC_KEY), false);
      assert.equal(serialized.includes("Return a short diagnostic fixture response."), false);
      assert.equal(serialized.includes("fixture throttled"), false);
      return true;
    },
  );
  assert.equal(fetches, 1);
});

test("successful Groq cognition reports content-free usage and token-capacity metadata", async () => {
  const userMessage = "Explain a simple tradeoff in ordinary language.";
  const responseText = "A bounded ordinary explanation.";
  const runtime = new GroqKnowledgeSimplifierModelRuntime(
    new GroqKnowledgeSimplifierModelProvider({
      apiKey: DIAGNOSTIC_KEY,
      rateLimitCoordinator: new MemoryGroqRateLimitCoordinator(),
      fetchImpl: async () => new Response(JSON.stringify({
        id: "diagnostic-cognition-success",
        model: GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
        choices: [{
          message: {
            content: JSON.stringify({
              mode: "CONVERSATION",
              response: responseText,
            }),
          },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 640,
          completion_tokens: 83,
          total_tokens: 723,
        },
      }), {
        status: 200,
        headers: {
          "x-ratelimit-limit-tokens": "8000",
          "x-ratelimit-remaining-tokens": "6400",
          "x-ratelimit-reset-tokens": "12.500s",
        },
      }),
    }),
  );
  const cognition = new ModelSolandraCognitiveRuntime(
    runtime,
    GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
    2,
  );
  const result = await cognition.interpret({
    conversationId: "diagnostic-success-conversation",
    messageId: "diagnostic-success-message",
    message: userMessage,
    recentUserMessages: [userMessage],
    governedKnowledge: [],
  });

  assert.equal(result.mode, "CONVERSATION");
  const observed = result.operationalDiagnostic;
  assert.ok(observed);
  assert.equal(observed.outcome, "SUCCESS");
  assert.equal(observed.providerStatus, 200);
  assert.equal(observed.promptTokens, 640);
  assert.equal(observed.completionTokens, 83);
  assert.equal(observed.totalTokens, 723);
  assert.equal(observed.rateLimitLimitTokens, 8_000);
  assert.equal(observed.rateLimitRemainingTokens, 6_400);
  assert.equal(observed.rateLimitResetTokensMs, 12_500);
  assert.equal(observed.maxOutputTokens, 1_600);
  assert.ok(observed.modelElapsedMs >= 0);
  const serialized = JSON.stringify(observed);
  assert.equal(serialized.includes(DIAGNOSTIC_KEY), false);
  assert.equal(serialized.includes(userMessage), false);
  assert.equal(serialized.includes(responseText), false);
});
