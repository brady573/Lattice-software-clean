import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import { buildAcceptedChoiceRecord } from "../src/intent/accepted-choice-store.js";
import type { IntentVersion } from "../src/intent/types.js";
import type { LoadedKnowledge } from "../src/knowledge/knowledge-continuity.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import {
  establishRecommendation,
  renderRecommendation,
} from "../src/recommendation/recommendation-continuity.js";
import { recommendationOptions } from "../src/recommendation/recommendation-options.js";
import { MemoryRecommendationStore } from "../src/recommendation/recommendation-store.js";
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
const USER_REQUEST = "Choose option A or option B. My deployment window is flexible.";
const GOVERNED_UNCERTAINTY = "Future outage performance is not established by the governed comparison.";
const DECLARED_FACT = "Option A has fewer required maintenance steps.";
const SECOND_DECLARED_FACT = "Option A has a documented rollback procedure.";
const SIBLING_FACT = "Option B had lower measured downtime last quarter.";
const UNSUPPORTED_FACT = "its vendor guarantees zero outages forever";

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
      value: { state: "VALUE", value: USER_REQUEST },
      provenance: {
        kind: "EXPLICIT_USER",
        logicalUserTurnId: "turn-issue-45",
        sourceMessageId: SOURCE_MESSAGE_ID,
        sourceDigest: "a".repeat(64),
      },
    },
    requirements: {},
    preferences: {},
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
      objective: USER_REQUEST,
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

function governedKnowledge(): LoadedKnowledge {
  const knowledgeRun: LatticeRun = {
    ...completedAdvisoryRun(),
    id: "run-issue-45-knowledge",
  };
  return {
    record: {
      knowledgeId: "knowledge-issue-45",
      conversationId: CONVERSATION_ID,
      runId: knowledgeRun.id,
      intentScopeId: INTENT_SCOPE_ID,
      intentVersionId: INTENT_VERSION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      objective: USER_REQUEST,
      claimIds: ["claim-declared-a", "claim-declared-b", "claim-sibling"],
      sourceIds: [],
      evidenceIds: [],
      truthAssessmentIds: [],
      uncertainties: [GOVERNED_UNCERTAINTY],
      asOf: FIXED_TIME,
      createdAt: FIXED_TIME,
    },
    run: knowledgeRun,
    truth: {
      runId: knowledgeRun.id,
      provenanceComponents: [],
      researchQuestions: [],
      sources: [],
      sourceEdges: [],
      claims: [],
      claimEvidence: [],
      obligations: [],
      checks: [],
      assessments: [],
    },
    knowledge: {
      kind: "KNOWLEDGE",
      objective: USER_REQUEST,
      acceptedUnderstanding: USER_REQUEST,
      findings: [
        {
          claimId: "claim-declared-a",
          text: DECLARED_FACT,
          status: "SUPPORTED",
          confidence: "HIGH",
          evidenceIds: [],
          contradictoryEvidenceIds: [],
          temporalQualifiers: { effectiveAt: null, period: null },
          basis: "CLAIM",
        },
        {
          claimId: "claim-declared-b",
          text: SECOND_DECLARED_FACT,
          status: "SUPPORTED",
          confidence: "HIGH",
          evidenceIds: [],
          contradictoryEvidenceIds: [],
          temporalQualifiers: { effectiveAt: null, period: null },
          basis: "CLAIM",
        },
        {
          claimId: "claim-sibling",
          text: SIBLING_FACT,
          status: "SUPPORTED",
          confidence: "HIGH",
          evidenceIds: [],
          contradictoryEvidenceIds: [],
          temporalQualifiers: { effectiveAt: null, period: null },
          basis: "CLAIM",
        },
      ],
      uncertainties: [GOVERNED_UNCERTAINTY],
      provenance: [],
      evidence: [],
      truthAssessmentIds: [],
    },
  };
}

function advisory(overrides: Partial<SolandraRecommendationResult> = {}): SolandraRecommendationResult {
  return {
    status: "RECOMMENDATION",
    recommendation: "option A",
    basis: [],
    rationale: ["I favor option A given the USER's stated priority."],
    tradeoffs: ["Generated drafting tradeoff that must not become durable."],
    assumptions: ["My deployment window is flexible."],
    uncertainties: ["Generated uncertainty explanation that must not become durable."],
    preservedUncertainties: [],
    alternatives: ["option B"],
    ...overrides,
  };
}

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
        recommendation: `Prefer option A because ${UNSUPPORTED_FACT}.`,
        basis: [{ knowledgeId: "knowledge-issue-45", claimIds: ["claim-declared-a"] }],
        rationale: [`The vendor claim means option A is safer.`],
        tradeoffs: [],
        assumptions: ["My deployment window is flexible."],
        uncertainties: [GOVERNED_UNCERTAINTY],
        preservedUncertainties: [GOVERNED_UNCERTAINTY],
        alternatives: ["option B"],
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
  const knowledge = governedKnowledge();
  return {
    conversationId: CONVERSATION_ID,
    userMessageId: SOURCE_MESSAGE_ID,
    authoritativeIntent: INTENT,
    authoritativeObjective: USER_REQUEST,
    userContext: [USER_REQUEST],
    knowledge: [{
      knowledgeId: knowledge.record.knowledgeId,
      objective: knowledge.record.objective,
      findings: knowledge.knowledge.findings.map((finding) => ({
        claimId: finding.claimId,
        text: finding.text,
        status: finding.status,
        confidence: finding.confidence,
      })),
      uncertainties: [...knowledge.knowledge.uncertainties],
      asOf: knowledge.record.asOf,
    }],
  };
}

test("Issue #45: false-positive GROUNDED cannot make unsupported factual draft prose durable", async () => {
  const provider = new GroundedButUnsupportedProseProvider();
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "issue-45-model");
  const generated = await runtime.advise(groundingInput());
  assert.equal(provider.calls, 2);
  assert.equal(generated.result.status, "RECOMMENDATION");
  if (generated.result.status !== "RECOMMENDATION") return;

  const store = new MemoryRecommendationStore();
  try {
    await assert.rejects(
      establishRecommendation({
        store,
        run: completedAdvisoryRun(),
        intentVersion: INTENT,
        knowledge: [governedKnowledge()],
        advisory: generated.result,
      }),
      /exact excerpt of authoritative USER material/iu,
    );
    assert.deepEqual(await store.listRecommendationsByConversation(CONVERSATION_ID), []);
  } finally {
    await store.close();
  }
});

test("Issue #45: governed factual support is rendered from exact declared claim content, not generated prose", async () => {
  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run: completedAdvisoryRun(),
      intentVersion: INTENT,
      knowledge: [governedKnowledge()],
      advisory: advisory({
        basis: [{ knowledgeId: "knowledge-issue-45", claimIds: ["claim-declared-a"] }],
        rationale: [`Use option A because ${UNSUPPORTED_FACT}.`],
        preservedUncertainties: [GOVERNED_UNCERTAINTY],
      }),
    });

    assert.equal(record.recommendation, "option A");
    assert.deepEqual(record.rationale, [DECLARED_FACT]);
    assert.deepEqual(record.tradeoffs, []);
    assert.deepEqual(record.uncertainties, [GOVERNED_UNCERTAINTY]);
    assert.doesNotMatch(JSON.stringify(record), new RegExp(UNSUPPORTED_FACT, "u"));
    const rendered = renderRecommendation(record);
    assert.match(rendered, new RegExp(DECLARED_FACT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    assert.doesNotMatch(rendered, new RegExp(UNSUPPORTED_FACT, "u"));
  } finally {
    await store.close();
  }
});

test("Issue #45: USER premise remains exact USER-derived material and invented assumptions are discarded", async () => {
  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run: completedAdvisoryRun(),
      intentVersion: INTENT,
      knowledge: [],
      advisory: advisory({
        assumptions: [
          "My deployment window is flexible.",
          "The vendor has never had an outage.",
        ],
      }),
    });

    assert.deepEqual(record.premiseAuthority.knowledge, []);
    assert.deepEqual(record.premiseAuthority.user, [
      { intentVersionId: INTENT_VERSION_ID, sourceMessageId: SOURCE_MESSAGE_ID },
    ]);
    assert.deepEqual(record.assumptions, ["My deployment window is flexible."]);
    assert.doesNotMatch(JSON.stringify(record), /vendor has never had an outage/iu);
    assert.match(renderRecommendation(record), /From your message:/u);
  } finally {
    await store.close();
  }
});

test("Issue #45: preference-sensitive advisory ranking remains available over exact USER options", async () => {
  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run: completedAdvisoryRun(),
      intentVersion: INTENT,
      knowledge: [],
      advisory: advisory(),
    });

    const rendered = renderRecommendation(record);
    assert.match(rendered, /I favor: option A/u);
    assert.match(rendered, /2\. option B/u);
    assert.match(rendered, /If your stated priorities or premises change/u);
  } finally {
    await store.close();
  }
});

test("Issue #45: multiple exact governed claims support one Recommendation without exposing sibling claims", async () => {
  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run: completedAdvisoryRun(),
      intentVersion: INTENT,
      knowledge: [governedKnowledge()],
      advisory: advisory({
        basis: [{
          knowledgeId: "knowledge-issue-45",
          claimIds: ["claim-declared-b", "claim-declared-a"],
        }],
        preservedUncertainties: [GOVERNED_UNCERTAINTY],
      }),
    });

    assert.deepEqual(record.premiseAuthority.knowledge, [{
      knowledgeId: "knowledge-issue-45",
      claimIds: ["claim-declared-a", "claim-declared-b"],
    }]);
    assert.deepEqual(record.rationale, [DECLARED_FACT, SECOND_DECLARED_FACT]);
    assert.doesNotMatch(JSON.stringify(record), new RegExp(SIBLING_FACT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    assert.doesNotMatch(JSON.stringify(record), /claim-sibling/u);
  } finally {
    await store.close();
  }
});

test("Issue #45: governed uncertainty cannot be dropped during Recommendation establishment", async () => {
  const store = new MemoryRecommendationStore();
  try {
    await assert.rejects(
      establishRecommendation({
        store,
        run: completedAdvisoryRun(),
        intentVersion: INTENT,
        knowledge: [governedKnowledge()],
        advisory: advisory({
          basis: [{ knowledgeId: "knowledge-issue-45", claimIds: ["claim-declared-a"] }],
          preservedUncertainties: [],
        }),
      }),
      /dropped or invented material governed uncertainty/iu,
    );
  } finally {
    await store.close();
  }
});

test("Issue #45: USER-only Recommendation establishes without external Knowledge", async () => {
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
    assert.equal(record.representationKind, "STRUCTURAL_USER_MATERIAL_V1");
    assert.equal(record.createdAt, FIXED_TIME);
  } finally {
    await store.close();
  }
});

test("Issue #45: option identity is stable and AcceptedChoice remains non-authorizing", async () => {
  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run: completedAdvisoryRun(),
      intentVersion: INTENT,
      knowledge: [],
      advisory: advisory(),
    });
    const first = recommendationOptions(record);
    const second = recommendationOptions(record);
    assert.deepEqual(second, first);
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
  } finally {
    await store.close();
  }
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
