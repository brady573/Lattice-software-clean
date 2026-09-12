import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import { buildAcceptedChoiceRecord } from "../src/intent/accepted-choice-store.js";
import type { IntentVersion } from "../src/intent/types.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { establishRecommendation } from "../src/recommendation/recommendation-continuity.js";
import { recommendationOptions } from "../src/recommendation/recommendation-options.js";
import {
  buildRecommendationRecord,
  MemoryRecommendationStore,
} from "../src/recommendation/recommendation-store.js";
import {
  ModelSolandraAdvisoryRuntime,
  type SolandraAdvisoryInput,
  type SolandraRecommendationResult,
} from "../src/solandra/advisory.js";

const FIXED_TIME = "2026-09-12T14:20:00.000Z";
const CONVERSATION_ID = "issue-45-premise-authority";
const INTENT_SCOPE_ID = "consultation:issue-45-premise-authority";
const INTENT_VERSION_ID = "intent-issue-45-v1";
const SOURCE_MESSAGE_ID = "message-issue-45";

const INTENT: IntentVersion = {
  intentScopeId: INTENT_SCOPE_ID,
  intentVersionId: INTENT_VERSION_ID,
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: "transition-issue-45-v1",
  lineageKind: "INITIAL",
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: "VALUE", value: "Choose the quieter workspace layout." },
      provenance: {
        kind: "EXPLICIT_USER",
        logicalUserTurnId: "turn-issue-45",
        sourceMessageId: SOURCE_MESSAGE_ID,
        sourceDigest: "a".repeat(64),
      },
    },
    requirements: {},
    preferences: {
      quiet: {
        value: { state: "VALUE", value: true },
        provenance: {
          kind: "EXPLICIT_USER",
          logicalUserTurnId: "turn-issue-45",
          sourceMessageId: SOURCE_MESSAGE_ID,
          sourceDigest: "a".repeat(64),
        },
      },
    },
  },
  createdAt: FIXED_TIME,
};

function completedAdvisoryRun(intentVersionId = INTENT_VERSION_ID): LatticeRun {
  return {
    id: "run-issue-45",
    conversationId: CONVERSATION_ID,
    status: "COMPLETED",
    version: 4,
    request: {
      kind: "consultation",
      objective: "Choose the quieter workspace layout.",
      context: [],
      investigationQueries: [],
      advisoryRequested: true,
      decisionNeed: "NONE",
      resourceNeed: "NONE",
      sourceMessageId: SOURCE_MESSAGE_ID,
      sourceMessageDigest: "a".repeat(64),
      intentVersion: 1,
      intentScopeId: INTENT_SCOPE_ID,
      intentVersionId,
    },
    decision: null,
    explanation: null,
    truthAssessmentIds: [],
    events: [
      { sequence: 1, type: "CREATED" },
      { sequence: 2, type: "COMPLETED" },
    ],
  };
}

function advisory(overrides: Partial<SolandraRecommendationResult> = {}): SolandraRecommendationResult {
  return {
    status: "RECOMMENDATION",
    recommendation: "Prefer the layout that best matches the USER's quiet-work preference.",
    basis: [],
    rationale: ["Given the USER's stated preference, I favor the quieter option."],
    tradeoffs: ["This preference-sensitive ranking could change if the USER changes priorities."],
    assumptions: ["The USER's stated quiet-work preference remains controlling."],
    uncertainties: [],
    preservedUncertainties: [],
    alternatives: ["Keep the current layout."],
    ...overrides,
  };
}

test("Issue #45: USER-preference-only Recommendation establishes exact USER premise authority without Knowledge", async () => {
  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run: completedAdvisoryRun(),
      intentVersion: INTENT,
      knowledge: [],
      advisory: advisory(),
    });

    assert.deepEqual(record.basis, []);
    assert.deepEqual(record.knowledgeIds, []);
    assert.deepEqual(record.claimIds, []);
    assert.deepEqual(record.userMaterialBasis, [INTENT_VERSION_ID, SOURCE_MESSAGE_ID].sort());
    assert.deepEqual(record.premiseAuthority, {
      knowledge: [],
      user: [{ intentVersionId: INTENT_VERSION_ID, sourceMessageId: SOURCE_MESSAGE_ID }],
    });
    assert.equal(record.createdAt, FIXED_TIME);
  } finally {
    await store.close();
  }
});

test("Issue #45: multiple governed claim identities remain exact and do not expand to sibling claims", () => {
  const record = buildRecommendationRecord({
    conversationId: CONVERSATION_ID,
    runId: "run-multiple-claims",
    intentScopeId: INTENT_SCOPE_ID,
    intentVersionId: INTENT_VERSION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    basis: [
      { knowledgeId: "knowledge-a", claimIds: ["claim-a2", "claim-a1"] },
      { knowledgeId: "knowledge-b", claimIds: ["claim-b1"] },
    ],
    userMaterialBasis: [INTENT_VERSION_ID, SOURCE_MESSAGE_ID],
    recommendation: "I favor option A after weighing the declared premises against the USER's preference.",
    rationale: ["The ranking is advisory judgment, not a new factual claim."],
    tradeoffs: [],
    assumptions: [],
    uncertainties: ["One governed comparison remains uncertain."],
    alternatives: ["Option B"],
    createdAt: FIXED_TIME,
  });

  assert.deepEqual(record.premiseAuthority.knowledge, [
    { knowledgeId: "knowledge-a", claimIds: ["claim-a1", "claim-a2"] },
    { knowledgeId: "knowledge-b", claimIds: ["claim-b1"] },
  ]);
  assert.doesNotMatch(JSON.stringify(record.premiseAuthority), /claim-a3|claim-b2/u);
});

class GroundedButUnsupportedProseProvider implements ModelProvider {
  readonly kind = "issue-45-grounded-unsupported-prose";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    const grounding = (request.messages[0]?.content ?? "").includes("bounded grounding verifier");
    const text = grounding
      ? JSON.stringify({ status: "GROUNDED", unsupportedExternalPremises: [], knowledgeNeeds: [] })
      : JSON.stringify({
        status: "RECOMMENDATION",
        recommendation: "Prefer option A because its vendor guarantees zero outages forever.",
        basis: [{ knowledgeId: "knowledge-issue-45", claimIds: ["claim-declared"] }],
        rationale: ["I rank option A higher for the USER's stated stability preference."],
        tradeoffs: [],
        assumptions: ["The USER says the deployment window is flexible."],
        uncertainties: ["The governed comparison does not establish future outage performance."],
        preservedUncertainties: ["The governed comparison does not establish future outage performance."],
        alternatives: ["Option B"],
      });
    return {
      response: {
        id: `issue-45-grounded-${this.calls}`,
        model: request.model,
        output: [{ type: "text", text }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `issue-45-grounded-${this.calls}`,
      },
    };
  }
}

function groundingInput(): SolandraAdvisoryInput {
  return {
    conversationId: CONVERSATION_ID,
    userMessageId: SOURCE_MESSAGE_ID,
    authoritativeIntent: INTENT,
    authoritativeObjective: "Choose the quieter workspace layout.",
    userContext: ["The USER says the deployment window is flexible."],
    knowledge: [{
      knowledgeId: "knowledge-issue-45",
      objective: "Compare the two deployment options.",
      findings: [
        { claimId: "claim-declared", text: "Option A has fewer required maintenance steps.", status: "SUPPORTED", confidence: "HIGH" },
        { claimId: "claim-sibling", text: "Option B had lower measured downtime last quarter.", status: "SUPPORTED", confidence: "HIGH" },
      ],
      uncertainties: ["The governed comparison does not establish future outage performance."],
      asOf: FIXED_TIME,
    }],
  };
}

test("Issue #45: GROUNDED is only a drafting signal; unsupported prose never enters structural factual premise authority", async () => {
  const provider = new GroundedButUnsupportedProseProvider();
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "issue-45-model");
  const generated = await runtime.advise(groundingInput());

  assert.equal(provider.calls, 2);
  assert.equal(generated.result.status, "RECOMMENDATION");
  if (generated.result.status !== "RECOMMENDATION") return;

  const record = buildRecommendationRecord({
    conversationId: CONVERSATION_ID,
    runId: "run-grounded-unsupported-prose",
    intentScopeId: INTENT_SCOPE_ID,
    intentVersionId: INTENT_VERSION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    basis: generated.result.basis,
    userMaterialBasis: [INTENT_VERSION_ID, SOURCE_MESSAGE_ID],
    recommendation: generated.result.recommendation,
    rationale: generated.result.rationale,
    tradeoffs: generated.result.tradeoffs,
    assumptions: generated.result.assumptions,
    uncertainties: [...new Set([...generated.result.preservedUncertainties, ...generated.result.uncertainties])],
    alternatives: generated.result.alternatives,
    createdAt: FIXED_TIME,
  });

  assert.match(record.recommendation, /guarantees zero outages forever/u);
  assert.deepEqual(record.premiseAuthority.knowledge, [
    { knowledgeId: "knowledge-issue-45", claimIds: ["claim-declared"] },
  ]);
  assert.deepEqual(record.premiseAuthority.user, [
    { intentVersionId: INTENT_VERSION_ID, sourceMessageId: SOURCE_MESSAGE_ID },
  ]);
  const authoritativePremises = JSON.stringify(record.premiseAuthority);
  assert.doesNotMatch(authoritativePremises, /zero outages forever/u);
  assert.doesNotMatch(authoritativePremises, /claim-sibling/u);
});

test("Issue #45: USER-authored factual material remains USER-derived rather than governed Knowledge", () => {
  const userFact = "The USER says the workspace is shared after 3 PM.";
  const record = buildRecommendationRecord({
    conversationId: CONVERSATION_ID,
    runId: null,
    intentScopeId: INTENT_SCOPE_ID,
    intentVersionId: INTENT_VERSION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    basis: [],
    userMaterialBasis: [INTENT_VERSION_ID, SOURCE_MESSAGE_ID],
    recommendation: "Given that USER-supplied condition, I favor the layout with fewer shared-space conflicts.",
    rationale: ["The conclusion is conditional on the USER-supplied premise."],
    tradeoffs: [],
    assumptions: [userFact],
    uncertainties: [],
    alternatives: [],
    createdAt: FIXED_TIME,
  });

  assert.deepEqual(record.premiseAuthority.knowledge, []);
  assert.deepEqual(record.premiseAuthority.user, [
    { intentVersionId: INTENT_VERSION_ID, sourceMessageId: SOURCE_MESSAGE_ID },
  ]);
  assert.match(record.assumptions[0] ?? "", /USER says/u);
});

test("Issue #45: advisory ranking, option identity, and AcceptedChoice authority remain unchanged", () => {
  const record = buildRecommendationRecord({
    conversationId: CONVERSATION_ID,
    runId: null,
    intentScopeId: INTENT_SCOPE_ID,
    intentVersionId: INTENT_VERSION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    basis: [],
    userMaterialBasis: [INTENT_VERSION_ID, SOURCE_MESSAGE_ID],
    recommendation: "I favor option A because it better fits the USER's stated preference.",
    rationale: ["This is preference-sensitive advisory judgment."],
    tradeoffs: ["Option B may still be preferable under a different priority."],
    assumptions: [],
    uncertainties: [],
    alternatives: ["Option B"],
    createdAt: FIXED_TIME,
  });

  const first = recommendationOptions(record);
  const second = recommendationOptions(record);
  assert.deepEqual(second, first);
  assert.equal(first[0]?.recommended, true);

  const selected = first[1];
  assert.ok(selected);
  const choice = buildAcceptedChoiceRecord({
    conversationId: CONVERSATION_ID,
    intentScopeId: INTENT_SCOPE_ID,
    intentVersionId: INTENT_VERSION_ID,
    recommendationId: record.recommendationId,
    optionId: selected.optionId,
    optionText: selected.text,
    sourceMessageId: "message-choice-issue-45",
    sourceMessageDigest: "b".repeat(64),
    createdAt: FIXED_TIME,
  });
  assert.equal(record.selectionAuthorized, false);
  assert.equal(choice.authorizationGranted, false);
  assert.equal(choice.executionAuthorized, false);
});

test("Issue #45: governed uncertainty cannot be dropped from a declared Knowledge basis", async () => {
  class MissingUncertaintyProvider implements ModelProvider {
    readonly kind = "issue-45-missing-uncertainty";
    async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
      return {
        response: {
          id: "issue-45-missing-uncertainty",
          model: request.model,
          output: [{
            type: "text",
            text: JSON.stringify({
              status: "RECOMMENDATION",
              recommendation: "Prefer option A.",
              basis: [{ knowledgeId: "knowledge-issue-45", claimIds: ["claim-declared"] }],
              rationale: ["Advisory judgment."],
              tradeoffs: [],
              assumptions: [],
              uncertainties: [],
              preservedUncertainties: [],
              alternatives: [],
            }),
          }],
        },
        route: {
          actualProvider: this.kind,
          actualModel: request.model,
          upstreamRequestId: "issue-45-missing-uncertainty",
        },
      };
    }
  }

  const runtime = new ModelSolandraAdvisoryRuntime(
    new ModelRuntime(new MissingUncertaintyProvider()),
    "issue-45-model",
  );
  await assert.rejects(
    runtime.advise(groundingInput()),
    /dropped material governed uncertainty/iu,
  );
});

test("Issue #45: Recommendation establishment still fails closed on stale IntentVersion binding", async () => {
  const store = new MemoryRecommendationStore();
  try {
    await assert.rejects(
      establishRecommendation({
        store,
        run: completedAdvisoryRun("intent-issue-45-stale"),
        intentVersion: INTENT,
        knowledge: [],
        advisory: advisory(),
      }),
      /authoritative IntentVersion binding changed/iu,
    );
  } finally {
    await store.close();
  }
});
