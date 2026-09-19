import assert from "node:assert/strict";
import test from "node:test";
import type { LatticeRun } from "../src/domain.js";
import type { IntentVersion } from "../src/intent/types.js";
import type { LoadedKnowledge } from "../src/knowledge/knowledge-continuity.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelProviderResult,
} from "../src/model/types.js";
import { establishRecommendation } from "../src/recommendation/recommendation-continuity.js";
import { MemoryRecommendationStore } from "../src/recommendation/recommendation-store.js";
import {
  ModelSolandraAdvisoryRuntime,
  type SolandraAdvisoryInput,
} from "../src/solandra/advisory.js";

const FIXED_TIME = "2026-09-19T17:00:00.000Z";

function intent(
  conversationId: string,
  sourceMessageId: string,
  objective: string,
): IntentVersion {
  return {
    intentScopeId: `consultation:${conversationId}`,
    intentVersionId: `intent:${conversationId}:v1`,
    version: 1,
    predecessorIntentVersionId: null,
    transitionId: `transition:${conversationId}:v1`,
    lineageKind: "INITIAL",
    lineageTargetIntentVersionId: null,
    state: {
      objective: {
        value: { state: "VALUE", value: objective },
        provenance: {
          kind: "EXPLICIT_USER",
          logicalUserTurnId: `turn:${conversationId}`,
          sourceMessageId,
          sourceDigest: "a".repeat(64),
        },
      },
      requirements: {},
      preferences: {},
    },
    createdAt: FIXED_TIME,
  };
}

function completedAdvisoryRun(
  conversationId: string,
  sourceMessageId: string,
  objective: string,
  version: IntentVersion,
): LatticeRun {
  return {
    id: `run:${conversationId}`,
    conversationId,
    status: "COMPLETED",
    version: 2,
    request: {
      kind: "consultation",
      objective,
      context: [],
      investigationQueries: [],
      advisoryRequested: true,
      decisionNeed: "NONE",
      resourceNeed: "NONE",
      sourceMessageId,
      sourceMessageDigest: "a".repeat(64),
      intentVersion: version.version,
      intentScopeId: version.intentScopeId,
      intentVersionId: version.intentVersionId,
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

class OneShotAdvisoryProvider implements ModelProvider {
  readonly kind = "issue-91-single-pass-held-out";
  calls = 0;

  constructor(private readonly response: Readonly<Record<string, unknown>>) {}

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    return {
      response: {
        id: `issue-91-held-out-${this.calls}`,
        model: request.model,
        output: [{ type: "text", text: JSON.stringify(this.response) }],
      },
      route: {
        actualProvider: this.kind,
        actualModel: request.model,
        upstreamRequestId: `issue-91-held-out-${this.calls}`,
      },
    };
  }
}

test("Issue #91 held-out: zero-Knowledge pottery-studio advice remains useful without manufacturing factual authority", async () => {
  const conversationId = "issue-91-held-out-pottery";
  const sourceMessageId = "message:pottery";
  const objective = "I have two free evenings. Help me choose a practice plan for wheel throwing; I care more about repetition than variety.";
  const version = intent(conversationId, sourceMessageId, objective);
  const provider = new OneShotAdvisoryProvider({
    status: "RECOMMENDATION",
    recommendation: "Use both evenings for short repeated cylinder drills, then finish each session by noting one adjustment for the next set.",
    basis: [],
    rationale: ["This prioritizes repetition over variety as requested."],
    tradeoffs: ["You will explore fewer forms during these sessions."],
    assumptions: [objective],
    uncertainties: [],
    alternatives: ["Split one evening between cylinders and bowls."],
  });
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "issue-91-held-out-model");
  const input: SolandraAdvisoryInput = {
    conversationId,
    userMessageId: sourceMessageId,
    authoritativeIntent: version,
    authoritativeObjective: objective,
    userContext: [objective],
    knowledge: [],
  };

  const generated = await runtime.advise(input);
  assert.equal(provider.calls, 1);
  assert.equal(generated.result.status, "RECOMMENDATION");
  if (generated.result.status !== "RECOMMENDATION") return;

  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run: completedAdvisoryRun(conversationId, sourceMessageId, objective, version),
      intentVersion: version,
      knowledge: [],
      advisory: generated.result,
    });
    assert.deepEqual(record.basis, []);
    assert.deepEqual(record.premiseAuthority.knowledge, []);
    assert.equal(record.proposals[0]?.origin, "SOLANDRA");
    assert.equal(record.proposals[0]?.factualAuthority, false);
    assert.deepEqual(record.rationale, []);
    assert.deepEqual(record.uncertainties, []);
    assert.deepEqual(record.assumptions, [objective]);
  } finally {
    await store.close();
  }
});

test("Issue #91 held-out: greenhouse advice persists factual support only from the exact selected governed claim", async () => {
  const conversationId = "issue-91-held-out-greenhouse";
  const sourceMessageId = "message:greenhouse";
  const objective = "Choose a watering schedule for my greenhouse bench using only the supplied evidence; I prefer fewer watering cycles.";
  const version = intent(conversationId, sourceMessageId, objective);
  const selectedFact = "The measured substrate retained target moisture for twelve hours after the morning watering cycle.";
  const siblingFact = "A separate bench used 18% less water with a different substrate.";
  const governedUncertainty = "The twelve-hour retention result has not been measured during hotter midsummer conditions.";
  const provider = new OneShotAdvisoryProvider({
    status: "RECOMMENDATION",
    recommendation: "Use one morning watering cycle because the controller is guaranteed to prevent afternoon wilt.",
    basis: [{ knowledgeId: "knowledge:greenhouse", claimIds: ["claim:retention"] }],
    rationale: ["One cycle appears to fit the preference for fewer cycles."],
    tradeoffs: ["This leaves less opportunity for midday adjustment."],
    assumptions: [objective],
    uncertainties: ["The model is uncertain about afternoon temperature."],
    alternatives: ["Add an afternoon watering cycle."],
  });
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "issue-91-held-out-model");
  const input: SolandraAdvisoryInput = {
    conversationId,
    userMessageId: sourceMessageId,
    authoritativeIntent: version,
    authoritativeObjective: objective,
    userContext: [objective],
    knowledge: [{
      knowledgeId: "knowledge:greenhouse",
      objective,
      findings: [
        { claimId: "claim:retention", text: selectedFact, status: "SUPPORTED", confidence: "HIGH" },
        { claimId: "claim:sibling", text: siblingFact, status: "SUPPORTED", confidence: "HIGH" },
      ],
      uncertainties: [governedUncertainty],
      asOf: FIXED_TIME,
    }],
  };

  const generated = await runtime.advise(input);
  assert.equal(provider.calls, 1);
  assert.equal(generated.result.status, "RECOMMENDATION");
  if (generated.result.status !== "RECOMMENDATION") return;

  const run = completedAdvisoryRun(conversationId, sourceMessageId, objective, version);
  const knowledgeRun = { ...run, id: "run:greenhouse-knowledge" };
  const knowledge: LoadedKnowledge = {
    record: {
      knowledgeId: "knowledge:greenhouse",
      conversationId,
      runId: knowledgeRun.id,
      intentScopeId: version.intentScopeId,
      intentVersionId: version.intentVersionId,
      sourceMessageId,
      objective,
      claimIds: ["claim:retention", "claim:sibling"],
      sourceIds: [],
      evidenceIds: [],
      truthAssessmentIds: [],
      uncertainties: [governedUncertainty],
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
      objective,
      acceptedUnderstanding: objective,
      findings: [
        {
          claimId: "claim:retention",
          text: selectedFact,
          status: "SUPPORTED",
          confidence: "HIGH",
          evidenceIds: [],
          contradictoryEvidenceIds: [],
          temporalQualifiers: { effectiveAt: null, period: null },
          basis: "CLAIM",
        },
        {
          claimId: "claim:sibling",
          text: siblingFact,
          status: "SUPPORTED",
          confidence: "HIGH",
          evidenceIds: [],
          contradictoryEvidenceIds: [],
          temporalQualifiers: { effectiveAt: null, period: null },
          basis: "CLAIM",
        },
      ],
      uncertainties: [governedUncertainty],
      provenance: [],
      evidence: [],
      truthAssessmentIds: [],
    },
  };

  const store = new MemoryRecommendationStore();
  try {
    const record = await establishRecommendation({
      store,
      run,
      intentVersion: version,
      knowledge: [knowledge],
      advisory: generated.result,
    });
    assert.deepEqual(record.basis, [{
      knowledgeId: "knowledge:greenhouse",
      claimIds: ["claim:retention"],
    }]);
    assert.deepEqual(record.rationale, [selectedFact]);
    assert.deepEqual(record.uncertainties, [governedUncertainty]);
    assert.equal(record.proposals[0]?.factualAuthority, false);
    assert.doesNotMatch(JSON.stringify(record.premiseAuthority), /claim:sibling/u);
    assert.doesNotMatch(JSON.stringify(record.rationale), /18% less water/u);
    assert.doesNotMatch(JSON.stringify(record.uncertainties), /afternoon temperature/u);
  } finally {
    await store.close();
  }
});
