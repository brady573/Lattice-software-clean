import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import { ModelProviderError } from "../src/model/errors.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { ModelSolandraAdvisoryRuntime } from "../src/solandra/advisory.js";
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
      this.allowedAfter.set(context.correlationId, Date.now() + 10);
      throw new ModelProviderError("rate_limit", "simulated provider TPM limit", {
        retryable: true,
        statusCode: 429,
        retryAfterMs: 10,
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
