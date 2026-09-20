import assert from "node:assert/strict";
import test from "node:test";
import type { IntentVersion } from "../src/intent/types.js";
import { ModelProviderError } from "../src/model/errors.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type { CanonicalModelRequest, ModelCallContext, ModelProviderResult } from "../src/model/types.js";
import { ModelSolandraActionPreparer } from "../src/solandra/action-preparer.js";
import { ModelSolandraAdvisoryRuntime } from "../src/solandra/advisory.js";
import { ModelSolandraCognitiveRuntime } from "../src/solandra/cognition.js";
import { ModelSolandraKnowledgeInvestigator } from "../src/solandra/knowledge-investigator.js";

const MODEL = "groq-retry-consumer-fixture";
const RETRYABLE = new ModelProviderError("rate_limit", "controlled transient 429", {
  retryable: true,
  statusCode: 429,
});

type Script = string | ModelProviderError;

class ScriptedRetryProvider implements ModelProvider {
  readonly kind = "scripted-retry-provider";
  calls = 0;
  readonly requests: CanonicalModelRequest[] = [];

  constructor(private readonly scripts: Script[]) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    this.requests.push(structuredClone(request));
    const script = this.scripts.shift();
    assert.ok(script !== undefined, "scripted provider exhausted");
    if (script instanceof ModelProviderError) throw script;
    return {
      response: {
        id: `scripted-${this.calls}`,
        model: request.model,
        output: [{ type: "text", text: script }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `scripted-${this.calls}`,
      },
    };
  }
}

function runtime(provider: ScriptedRetryProvider): ModelRuntime {
  return new ModelRuntime(provider, { timeoutMs: 30_000 });
}

const INTENT: IntentVersion = {
  intentScopeId: "groq-retry-advisory-scope",
  intentVersionId: "groq-retry-advisory-intent",
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: "groq-retry-advisory-transition",
  lineageKind: "INITIAL",
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: "VALUE", value: "Choose a calm label for my private notes." },
      provenance: {
        kind: "EXPLICIT_USER",
        logicalUserTurnId: "groq-retry-advisory-turn",
        sourceMessageId: "groq-retry-advisory-message",
        sourceDigest: "a".repeat(64),
      },
    },
    requirements: {},
    preferences: {},
  },
  createdAt: "2026-09-20T20:00:00.000Z",
};

test("ordinary Solandra cognition recovers one transient retryable provider failure in two attempts", async () => {
  const provider = new ScriptedRetryProvider([
    RETRYABLE,
    JSON.stringify({ mode: "CONVERSATION", response: "A quiet label could be Evening Notes." }),
  ]);
  const cognition = new ModelSolandraCognitiveRuntime(runtime(provider), MODEL);

  const result = await cognition.interpret({
    conversationId: "groq-retry-conversation",
    messageId: "groq-retry-message",
    message: "Give my private notes a calm label.",
    recentUserMessages: [],
    recentConversation: [],
    governedKnowledge: [],
    governedRecommendations: [],
  });

  assert.equal(result.mode, "CONVERSATION");
  assert.equal(provider.calls, 2);
});

test("Knowledge investigation planning recovers one transient retryable provider failure", async () => {
  const provider = new ScriptedRetryProvider([
    RETRYABLE,
    JSON.stringify({ retrievalQueries: ["lunar eclipse observation geometry"] }),
  ]);
  const investigator = new ModelSolandraKnowledgeInvestigator(runtime(provider), MODEL);

  const result = await investigator.plan({
    runId: "groq-retry-plan-run",
    objective: "Explain why a lunar eclipse can appear reddish.",
    context: [],
    knowledgeNeeds: ["Find an external explanation of the optical mechanism."],
  });

  assert.deepEqual(result.retrievalQueries, ["lunar eclipse observation geometry"]);
  assert.equal(provider.calls, 2);
});

test("Knowledge responsiveness recovers one transient retryable provider failure", async () => {
  const provider = new ScriptedRetryProvider([
    RETRYABLE,
    JSON.stringify({ selections: [] }),
  ]);
  const investigator = new ModelSolandraKnowledgeInvestigator(runtime(provider), MODEL);

  const result = await investigator.selectResponsive({
    runId: "groq-retry-responsive-run",
    objective: "Explain why a lunar eclipse can appear reddish.",
    context: [],
    knowledgeNeeds: ["Find an external explanation of the optical mechanism."],
    retrievalQueries: ["lunar eclipse observation geometry"],
    sources: [{
      sourceId: "source-1",
      canonicalUri: "https://example.test/eclipse",
      title: "Eclipse explanation",
      publisher: "Example",
      retrievedAt: "2026-09-20T20:00:00.000Z",
      publishedAt: null,
      contentType: "text/plain",
      content: "Candidate source material.",
    }],
    claims: [{
      claimId: "claim-1",
      text: "Candidate explanation.",
      claimType: "INTERPRETIVE",
      evidence: [{ sourceId: "source-1", relation: "SUPPORTS", excerpt: "Candidate explanation." }],
    }],
  });

  assert.deepEqual(result.selections, []);
  assert.equal(provider.calls, 2);
});

test("advisory reasoning recovers one transient retryable provider failure without creating factual authority", async () => {
  const provider = new ScriptedRetryProvider([
    RETRYABLE,
    JSON.stringify({
      status: "INSUFFICIENT_BASIS",
      reason: "The supplied USER material does not support a responsible recommendation yet.",
      uncertainties: ["The USER has not supplied a controlling preference."],
    }),
  ]);
  const advisory = new ModelSolandraAdvisoryRuntime(runtime(provider), MODEL);

  const result = await advisory.advise({
    conversationId: "groq-retry-advisory",
    userMessageId: "groq-retry-advisory-message",
    authoritativeIntent: INTENT,
    authoritativeObjective: "Choose a calm label for my private notes.",
    userContext: ["Choose a calm label for my private notes."],
    knowledge: [],
  });

  assert.equal(result.result.status, "INSUFFICIENT_BASIS");
  assert.equal(provider.calls, 2);
});

test("advisory grounding recovers one transient retryable provider failure without weakening governed basis checks", async () => {
  const provider = new ScriptedRetryProvider([
    JSON.stringify({
      status: "RECOMMENDATION",
      recommendation: "Evening Notes",
      basis: [],
      rationale: ["It matches the USER's request for a calm label."],
      tradeoffs: [],
      assumptions: [],
      uncertainties: [],
      preservedUncertainties: [],
      alternatives: ["Quiet Pages"],
    }),
    RETRYABLE,
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      knowledgeNeeds: [],
    }),
  ]);
  const advisory = new ModelSolandraAdvisoryRuntime(runtime(provider), MODEL);

  const result = await advisory.advise({
    conversationId: "groq-retry-advisory-grounding",
    userMessageId: "groq-retry-advisory-message",
    authoritativeIntent: INTENT,
    authoritativeObjective: "Choose a calm label for my private notes.",
    userContext: ["Choose a calm label for my private notes."],
    knowledge: [],
  });

  assert.equal(result.result.status, "RECOMMENDATION");
  assert.equal(provider.calls, 3);
});

test("Action Preparation generation recovers one transient retryable provider failure without creating authorization or execution", async () => {
  const provider = new ScriptedRetryProvider([
    RETRYABLE,
    JSON.stringify({
      status: "INSUFFICIENT_BASIS",
      reason: "More USER material is needed.",
      body: null,
      basis: [],
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime(provider), MODEL);

  const result = await preparer.prepare({
    conversationId: "groq-retry-action",
    runId: "groq-retry-action-run",
    intentVersionId: "groq-retry-action-intent",
    userMessageId: "groq-retry-action-message",
    userMessage: "Draft a note from only what I supplied.",
    authoritativeObjective: "Prepare a bounded draft.",
    knowledge: [],
  });

  assert.equal(result.result.status, "INSUFFICIENT_BASIS");
  assert.equal(provider.calls, 2);
});

test("Action Preparation grounding recovers one transient retryable provider failure and retains the preparation-only boundary", async () => {
  const provider = new ScriptedRetryProvider([
    JSON.stringify({
      status: "PREPARED",
      body: "Could you review this when you have time?",
      basis: [],
    }),
    RETRYABLE,
    JSON.stringify({
      status: "GROUNDED",
      unsupportedExternalPremises: [],
      materialUncertaintyPreserved: true,
      authorityBoundaryPreserved: true,
    }),
  ]);
  const preparer = new ModelSolandraActionPreparer(runtime(provider), MODEL);

  const result = await preparer.prepare({
    conversationId: "groq-retry-action-grounding",
    runId: "groq-retry-action-grounding-run",
    intentVersionId: "groq-retry-action-intent",
    userMessageId: "groq-retry-action-message",
    userMessage: "Draft a short request asking someone to review this.",
    authoritativeObjective: "Prepare a bounded draft.",
    knowledge: [],
  });

  assert.equal(result.result.status, "PREPARED");
  if (result.result.status !== "PREPARED") return;
  assert.equal(result.result.body, "Could you review this when you have time?");
  assert.deepEqual(result.result.basis, []);
  assert.equal(provider.calls, 3);
});
