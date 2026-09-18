import assert from "node:assert/strict";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { IntentVersion } from "../src/intent/types.js";
import { ModelProviderError } from "../src/model/errors.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import {
  ModelSolandraAdvisoryRuntime,
  type SolandraAdvisoryInput,
  type SolandraAdvisoryRuntime,
  type SolandraAdvisoryRuntimeResult,
} from "../src/solandra/advisory.js";
import {
  ModelSolandraCognitiveRuntime,
} from "../src/solandra/cognition.js";

const MODEL = "issue-91-rate-limit-fixture";
const HELD_OUT_DECISION =
  "I can review our community garden volunteer schedule briefly each morning or do one longer review each Friday. I care most about catching conflicts early, but I also want to keep the routine lightweight. Which approach should I use?";

function modelResult(request: CanonicalModelRequest, text: string, id: string): ModelProviderResult {
  return {
    response: {
      id,
      model: request.model,
      output: [{ type: "text", text }],
    },
    route: {
      actualProvider: "issue-91-rate-limit-fixture",
      actualModel: request.model,
    },
  };
}

class RateLimitedDecisionCognitionProvider implements ModelProvider {
  readonly kind = "issue-91-rate-limit-cognition";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    if (this.calls === 1) {
      throw new ModelProviderError("rate_limit", "fixture rate limit", {
        retryable: true,
        statusCode: 429,
        retryAfterMs: 0,
      });
    }
    return modelResult(request, JSON.stringify({
      mode: "GOVERNED",
      projection: {
        objectiveRelation: "NEW_OBJECTIVE",
        proposedObjective: null,
        requestedHelp: "DECISION",
        relevantContext: [],
        entities: ["community garden volunteer schedule"],
        referents: [],
        constraints: ["keep the routine lightweight"],
        preferences: ["catch conflicts early"],
        knowledgeNeeds: [],
        materialAmbiguity: null,
        referencedKnowledgeId: null,
        referencedRecommendationId: null,
        referencedOptionId: null,
        referencedIntentProposalId: null,
      },
    }), "cognition-recovered");
  }
}

class HeldOutAdvisory implements SolandraAdvisoryRuntime {
  calls = 0;

  async advise(_input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    this.calls += 1;
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Use the brief morning review.",
        basis: [],
        rationale: ["It directly matches the USER's stated priority to catch conflicts early while keeping the routine lightweight."],
        tradeoffs: ["A daily check requires a small recurring commitment."],
        assumptions: ["catching conflicts early", "keep the routine lightweight"],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Use one longer Friday review."],
      },
      invocationProvenance: {
        executionClass: "LOCAL_OFFLINE",
        routeMode: "PINNED",
        requestedProvider: "issue-91-held-out-advisory",
        requestedModel: "issue-91-held-out-advisory",
        actualProvider: "issue-91-held-out-advisory",
        actualModel: "issue-91-held-out-advisory",
        brokerIdentity: null,
        brokerVersion: null,
        upstreamRequestId: "held-out-advisory",
        routeProvenance: "COMPLETE",
      },
    };
  }
}

async function createConversation(app: FastifyInstance): Promise<string> {
  const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(created.statusCode, 201, created.body);
  return created.json<{ conversation: { id: string } }>().conversation.id;
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
  LATTICE_AUTHENTICATION_MODE: "development-fixture",
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "issue-91-rate-limit-user",
} as NodeJS.ProcessEnv);

test("Issue #91 held-out decision recovers from one retryable cognition rate limit instead of returning HTTP 422", async () => {
  const provider = new RateLimitedDecisionCognitionProvider();
  const advisory = new HeldOutAdvisory();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    solandraCognition: new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), MODEL),
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: "held-out-rate-limit-decision", message: HELD_OUT_DECISION },
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json<{
      status: string;
      interpretation: { requestedHelp: string };
      recommendationReference: { selectionAuthorized: boolean };
    }>();
    assert.equal(body.status, "RECOMMENDATION_ESTABLISHED");
    assert.equal(body.interpretation.requestedHelp, "DECISION");
    assert.equal(body.recommendationReference.selectionAuthorized, false);
    assert.equal(provider.calls, 2);
    assert.equal(advisory.calls, 1);
  } finally {
    await app.close();
  }
});

class AdvisoryRateLimitProvider implements ModelProvider {
  readonly kind = "issue-91-rate-limit-advisory";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    if (this.calls === 1 || this.calls === 3) {
      throw new ModelProviderError("rate_limit", "fixture rate limit", {
        retryable: true,
        statusCode: 429,
        retryAfterMs: 0,
      });
    }
    if (this.calls === 2) {
      return modelResult(request, JSON.stringify({
        status: "RECOMMENDATION",
        recommendation: "Use the brief morning review.",
        basis: [],
        rationale: ["It matches the USER's stated priorities."],
        tradeoffs: ["It creates a small daily routine."],
        assumptions: ["catching conflicts early"],
        uncertainties: [],
        preservedUncertainties: [],
        alternatives: ["Use one longer Friday review."],
      }), "advisory-recovered");
    }
    return modelResult(request, JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      knowledgeNeeds: [],
    }), "grounding-recovered");
  }
}

function advisoryIntent(): IntentVersion {
  return {
    intentScopeId: "consultation:held-out-rate-limit",
    intentVersionId: "intent-held-out-rate-limit",
    version: 1,
    predecessorIntentVersionId: null,
    transitionId: "transition-held-out-rate-limit",
    lineageKind: "INITIAL",
    lineageTargetIntentVersionId: null,
    state: {
      objective: {
        value: { state: "VALUE", value: HELD_OUT_DECISION },
        provenance: {
          kind: "EXPLICIT_USER",
          logicalUserTurnId: "held-out-rate-limit-decision",
          sourceMessageId: "held-out-rate-limit-message",
          sourceDigest: "held-out-rate-limit-digest",
        },
      },
      requirements: {},
      preferences: {},
    },
    createdAt: "2026-09-17T00:00:00.000Z",
  };
}

test("Issue #91 advisory and grounding calls use the same bounded retry resilience", async () => {
  const provider = new AdvisoryRateLimitProvider();
  const advisory = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), MODEL);
  const result = await advisory.advise({
    conversationId: "held-out-rate-limit",
    userMessageId: "held-out-rate-limit-message",
    authoritativeIntent: advisoryIntent(),
    authoritativeObjective: HELD_OUT_DECISION,
    userContext: [HELD_OUT_DECISION],
    knowledge: [],
  });

  assert.equal(result.result.status, "RECOMMENDATION");
  assert.equal(provider.calls, 4);
});

class NonRetryableCognitionProvider implements ModelProvider {
  readonly kind = "issue-91-non-retryable-cognition";
  calls = 0;

  async generate(): Promise<ModelProviderResult> {
    this.calls += 1;
    throw new ModelProviderError("invalid_output", "do not retry semantic invalidity");
  }
}

test("Issue #91 cognition does not retry non-retryable semantic failure", async () => {
  const provider = new NonRetryableCognitionProvider();
  const cognition = new ModelSolandraCognitiveRuntime(new ModelRuntime(provider), MODEL);
  await assert.rejects(
    () => cognition.interpret({
      conversationId: "non-retryable",
      messageId: "non-retryable-message",
      message: "Help me choose between two routines.",
      recentUserMessages: ["Help me choose between two routines."],
      governedKnowledge: [],
    }),
    (error: unknown) => error instanceof ModelProviderError && error.code === "invalid_output",
  );
  assert.equal(provider.calls, 1);
});
