import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ConsultationInterpreter } from "../src/intent/consultation-interpreter.js";
import type { IntentVersion } from "../src/intent/types.js";
import type {
  KnowledgeAcquisitionProvider,
  KnowledgeAcquisitionRequest,
  KnowledgeAcquisitionResult,
} from "../src/knowledge/acquisition.js";
import type { ModelProvider } from "../src/model/provider.js";
import { ModelRuntime } from "../src/model/runtime.js";
import type {
  CanonicalModelRequest,
  ModelCallContext,
  ModelInvocationProvenance,
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
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import { KnowledgeAcquisitionTruthPipeline } from "../src/truth/knowledge-acquisition-pipeline.js";

const FIRST_USER = "Help me choose between two implementation approaches while keeping maintenance burden low.";
const SECOND_USER = "Change the objective: choose the approach that is easiest to reverse later.";
const FIRST_NEED = "maintenance burden and reversibility evidence for the available implementation approaches";
const SECOND_NEED = "reversibility evidence for the available implementation approaches";
const FINDING = "A smaller maintenance surface can reduce the amount of ongoing work required to keep an implementation usable.";
const SECOND_FINDING = "An implementation with fewer irreversible dependencies is generally easier to replace or unwind later.";
const EXTRA_FINDING = "A broader dependency surface can increase the number of components that need ongoing maintenance.";
const FIXED_TIME = "2026-09-07T13:30:00.000Z";

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "m2-deterministic-solandra",
  requestedModel: "m2-deterministic-model",
  actualProvider: "m2-deterministic-solandra",
  actualModel: "m2-deterministic-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "m2-deterministic-request",
  routeProvenance: "COMPLETE",
});

function proposal(overrides: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "CONTINUE",
    proposedObjective: null,
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: [],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    ...overrides,
  };
}

class AdvisoryCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    const lower = input.message.toLocaleLowerCase("en-US");
    const latestRecommendation = input.governedRecommendations?.at(-1)?.recommendationId ?? null;
    if (lower.includes("why did you recommend")) {
      return {
        proposal: proposal({ requestedHelp: "EXPLAIN_RECOMMENDATION", referencedRecommendationId: latestRecommendation }),
        invocationProvenance: PROVENANCE,
      };
    }
    if (lower.includes("sources behind that recommendation")) {
      return {
        proposal: proposal({ requestedHelp: "SOURCES_RECOMMENDATION", referencedRecommendationId: latestRecommendation }),
        invocationProvenance: PROVENANCE,
      };
    }
    const changed = input.message === SECOND_USER;
    return {
      proposal: proposal({
        objectiveRelation: input.currentObjective === undefined || changed ? "NEW_OBJECTIVE" : "CONTINUE",
        proposedObjective: "Model wording must not become authoritative USER intent.",
        requestedHelp: "DECISION",
        constraints: ["Model-extracted context remains non-authoritative."],
        knowledgeNeeds: [changed ? SECOND_NEED : FIRST_NEED],
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class ForbiddenLegacyInterpreter implements ConsultationInterpreter {
  calls = 0;
  async interpret(): Promise<never> {
    this.calls += 1;
    throw new Error("Legacy deterministic interpreter must not run for M2 DECISION cognition.");
  }
}

class RecordingAcquisition implements KnowledgeAcquisitionProvider {
  readonly kind = "m2-recording-acquisition";
  readonly requests: KnowledgeAcquisitionRequest[] = [];

  async acquire(request: KnowledgeAcquisitionRequest): Promise<KnowledgeAcquisitionResult> {
    this.requests.push(structuredClone(request));
    const changed = request.investigationQueries?.includes(SECOND_NEED) === true;
    const text = changed ? SECOND_FINDING : FINDING;
    const suffix = changed ? "second" : "first";
    return {
      sources: [{
        sourceId: `m2-${suffix}-source`,
        canonicalUri: `https://m2.example/${suffix}`,
        title: `M2 ${suffix} governed source`,
        publisher: "M2 Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: null,
        contentType: "text/plain",
        content: text,
      }, ...(!changed ? [{
        sourceId: "m2-first-extra-source",
        canonicalUri: "https://m2.example/first-extra",
        title: "M2 unrelated claim-basis source",
        publisher: "M2 Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: null,
        contentType: "text/plain",
        content: EXTRA_FINDING,
      }] : [])],
      claims: [{
        claimId: `m2-${suffix}-claim`,
        text,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: `m2-${suffix}-source`, relation: "SUPPORTS", excerpt: text }],
      }, ...(!changed ? [{
        claimId: "m2-first-extra-claim",
        text: EXTRA_FINDING,
        claimType: "INTERPRETIVE" as const,
        evidence: [{ sourceId: "m2-first-extra-source", relation: "SUPPORTS" as const, excerpt: EXTRA_FINDING }],
      }] : [])],
    };
  }
}

class RecordingAdvisory implements SolandraAdvisoryRuntime {
  readonly inputs: SolandraAdvisoryInput[] = [];

  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    this.inputs.push(structuredClone(input));
    const knowledge = input.knowledge[0];
    assert.ok(knowledge);
    const claim = knowledge.findings[0];
    assert.ok(claim);
    const changed = input.authoritativeObjective === SECOND_USER;
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: changed
          ? "Prefer the approach with the cleaner reversal path, subject to the governed evidence and uncertainty below."
          : "Prefer the approach with the lower ongoing maintenance burden, subject to the governed evidence and uncertainty below.",
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [claim.claimId] }],
        rationale: [changed ? SECOND_FINDING : FINDING],
        tradeoffs: ["The preferred approach may sacrifice benefits that were not established by the supplied Knowledge."],
        assumptions: ["The USER's stated objective remains the controlling preference for this advice."],
        uncertainties: [...knowledge.uncertainties],
        preservedUncertainties: [...knowledge.uncertainties],
        alternatives: ["Keep both approaches open if the unresolved evidence is material to the choice."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

class InsufficientAdvisory implements SolandraAdvisoryRuntime {
  calls = 0;
  async advise(): Promise<SolandraAdvisoryRuntimeResult> {
    this.calls += 1;
    return {
      result: {
        status: "INSUFFICIENT_BASIS",
        reason: "The governed basis does not establish enough to choose responsibly.",
        uncertainties: ["A material comparison remains unresolved."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForCompleted(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("M2 advisory Run did not complete.");
}

async function advisoryTurn(app: FastifyInstance, conversationId: string, message: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(response.statusCode, 202, response.body);
  const accepted = response.json<{
    status: string;
    runId: string;
    acceptedUnderstanding: string;
    intentVersionId: string;
    decisionNeed: string;
    interpretation: { requestedHelp: string; knowledgeNeeds: string[] };
  }>();
  assert.equal(accepted.status, "RUN_ACCEPTED");
  await waitForCompleted(app, accepted.runId);
  let outcome;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
    if (outcome.statusCode === 202) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      continue;
    }
    break;
  }
  assert.ok(outcome);
  assert.equal(outcome.statusCode, 200, outcome.body);
  return { accepted, outcome };
}

test("M2 general advisory spine preserves Intent/V36 authority and durable Recommendation continuity without legacy interpretation", async () => {
  const cognition = new AdvisoryCognition();
  const interpreter = new ForbiddenLegacyInterpreter();
  const acquisition = new RecordingAcquisition();
  const advisory = new RecordingAdvisory();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
    consultationInterpreter: interpreter,
    solandraCognition: cognition,
    solandraAdvisory: advisory,
  });

  try {
    const conversationId = await createConversation(app);
    const first = await advisoryTurn(app, conversationId, FIRST_USER);
    assert.equal(first.accepted.acceptedUnderstanding, FIRST_USER);
    assert.equal(first.accepted.decisionNeed, "NONE");
    assert.equal(first.accepted.interpretation.requestedHelp, "DECISION");
    assert.deepEqual(first.accepted.interpretation.knowledgeNeeds, [FIRST_NEED]);
    assert.equal(interpreter.calls, 0);
    assert.equal(acquisition.requests.length, 1);
    assert.deepEqual(acquisition.requests[0]?.investigationQueries, [FIRST_NEED]);
    assert.equal(advisory.inputs.length, 1);
    assert.equal(advisory.inputs[0]?.authoritativeObjective, FIRST_USER);
    assert.equal(advisory.inputs[0]?.authoritativeIntent.intentVersionId, first.accepted.intentVersionId);
    assert.ok(advisory.inputs[0]?.knowledge[0]?.knowledgeId);
    assert.ok(advisory.inputs[0]?.knowledge[0]?.findings[0]?.claimId);

    const run = await app.inject({ method: "GET", url: `/api/v1/runs/${first.accepted.runId}` });
    assert.equal(run.statusCode, 200, run.body);
    const request = run.json<{ request: { advisoryRequested: boolean; decisionNeed: string; decisionInput?: unknown; objective: string } }>().request;
    assert.equal(request.advisoryRequested, true);
    assert.equal(request.decisionNeed, "NONE");
    assert.equal(request.decisionInput, undefined);
    assert.equal(request.objective, FIRST_USER);

    const firstBody = first.outcome.json<{
      outcome: { kind: string; objective: string; uncertainties: string[] };
      knowledgeReference: { knowledgeId: string };
      recommendationReference: {
        recommendationId: string;
        intentVersionId: string;
        knowledgeIds: string[];
        claimIds: string[];
        selectionAuthorized: boolean;
      };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(firstBody.outcome.kind, "KNOWLEDGE");
    assert.equal(firstBody.outcome.objective, FIRST_USER);
    assert.equal(firstBody.recommendationReference.intentVersionId, first.accepted.intentVersionId);
    assert.deepEqual(firstBody.recommendationReference.knowledgeIds, [firstBody.knowledgeReference.knowledgeId]);
    assert.deepEqual(firstBody.recommendationReference.claimIds, [advisory.inputs[0]!.knowledge[0]!.findings[0]!.claimId]);
    assert.equal(firstBody.recommendationReference.selectionAuthorized, false);
    assert.doesNotMatch(firstBody.presentation.assistantMessage, /recommendation_|knowledge_|provider|model ID|workflow|stage/iu);
    for (const uncertainty of advisory.inputs[0]!.knowledge[0]!.uncertainties) {
      assert.ok(firstBody.presentation.assistantMessage.includes(uncertainty));
    }

    const recommendation = await app.inject({
      method: "GET",
      url: `/api/v1/recommendations/${firstBody.recommendationReference.recommendationId}`,
    });
    assert.equal(recommendation.statusCode, 200, recommendation.body);
    const recommendationRecord = recommendation.json<{
      recommendationId: string;
      conversationId: string;
      runId: string;
      intentVersionId: string;
      sourceMessageId: string;
      basis: Array<{ knowledgeId: string; claimIds: string[] }>;
      knowledgeIds: string[];
      claimIds: string[];
      factualBasis: Array<{ knowledgeId: string; claimIds: string[]; evidenceIds: string[]; sourceIds: string[] }>;
      uncertainties: string[];
      selectionAuthorized: boolean;
    }>();
    assert.equal(recommendationRecord.conversationId, conversationId);
    assert.equal(recommendationRecord.runId, first.accepted.runId);
    assert.equal(recommendationRecord.intentVersionId, first.accepted.intentVersionId);
    assert.equal(recommendationRecord.selectionAuthorized, false);
    assert.deepEqual(recommendationRecord.knowledgeIds, firstBody.recommendationReference.knowledgeIds);
    assert.deepEqual(recommendationRecord.claimIds, firstBody.recommendationReference.claimIds);
    assert.deepEqual(recommendationRecord.basis, [{
      knowledgeId: firstBody.knowledgeReference.knowledgeId,
      claimIds: firstBody.recommendationReference.claimIds,
    }]);
    assert.equal(recommendationRecord.factualBasis.length, 1);
    assert.deepEqual(recommendationRecord.factualBasis[0]?.claimIds, firstBody.recommendationReference.claimIds);
    assert.deepEqual(recommendationRecord.factualBasis[0]?.sourceIds, ["m2-first-source"]);
    assert.equal(recommendationRecord.factualBasis[0]?.evidenceIds.length, 1);
    for (const uncertainty of advisory.inputs[0]!.knowledge[0]!.uncertainties) {
      assert.ok(recommendationRecord.uncertainties.includes(uncertainty));
    }

    const replay = await app.inject({ method: "GET", url: `/api/v1/runs/${first.accepted.runId}/outcome` });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(
      replay.json<{ recommendationReference: { recommendationId: string } }>().recommendationReference.recommendationId,
      firstBody.recommendationReference.recommendationId,
    );
    assert.equal(advisory.inputs.length, 1);

    const why = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Why did you recommend that?" },
    });
    assert.equal(why.statusCode, 200, why.body);
    const whyBody = why.json<{
      status: string;
      recommendationReference: { recommendationId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(whyBody.status, "RECOMMENDATION_REFERENCE_RESOLVED");
    assert.equal(whyBody.recommendationReference.recommendationId, firstBody.recommendationReference.recommendationId);
    assert.match(whyBody.presentation.assistantMessage, /Why:/u);
    assert.equal(advisory.inputs.length, 1);
    assert.equal(acquisition.requests.length, 1);

    const sources = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Show me the sources behind that recommendation." },
    });
    assert.equal(sources.statusCode, 200, sources.body);
    const sourceBody = sources.json<{
      status: string;
      recommendationReference: { recommendationId: string };
      presentation: { assistantMessage: string };
    }>();
    assert.equal(sourceBody.status, "RECOMMENDATION_REFERENCE_RESOLVED");
    assert.equal(sourceBody.recommendationReference.recommendationId, firstBody.recommendationReference.recommendationId);
    assert.match(sourceBody.presentation.assistantMessage, /https:\/\/m2\.example\/first(?:\s|$)/iu);
    assert.doesNotMatch(sourceBody.presentation.assistantMessage, /first-extra/iu);
    assert.equal(advisory.inputs.length, 1);
    assert.equal(acquisition.requests.length, 1);

    const historicalBefore = recommendation.json();
    const second = await advisoryTurn(app, conversationId, SECOND_USER);
    const secondBody = second.outcome.json<{ recommendationReference: { recommendationId: string } }>();
    assert.notEqual(second.accepted.intentVersionId, first.accepted.intentVersionId);
    assert.notEqual(secondBody.recommendationReference.recommendationId, firstBody.recommendationReference.recommendationId);
    assert.equal(advisory.inputs.length, 2);
    assert.equal(acquisition.requests.length, 2);
    const historicalAfter = await app.inject({
      method: "GET",
      url: `/api/v1/recommendations/${firstBody.recommendationReference.recommendationId}`,
    });
    assert.equal(historicalAfter.statusCode, 200, historicalAfter.body);
    assert.deepEqual(historicalAfter.json(), historicalBefore);

    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    const recommendations = continuity.json<{ recommendations: Array<{ recommendationId: string; selectionAuthorized: boolean }> }>().recommendations;
    assert.equal(recommendations.length, 2);
    assert.deepEqual(new Set(recommendations.map((item) => item.recommendationId)).size, 2);
    assert.ok(recommendations.every((item) => item.selectionAuthorized === false));

    const root = await app.inject({ method: "GET", url: "/" });
    assert.equal(root.statusCode, 200, root.body);
    assert.match(root.body, /RECOMMENDATION_REFERENCE_RESOLVED/u);
  } finally {
    await app.close();
  }
});

test("M2 insufficient governed basis does not silently become a Recommendation", async () => {
  const acquisition = new RecordingAcquisition();
  const advisory = new InsufficientAdvisory();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
    solandraCognition: new AdvisoryCognition(),
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    const result = await advisoryTurn(app, conversationId, FIRST_USER);
    const body = result.outcome.json<{
      advisory: { status: string };
      recommendationReference?: unknown;
      presentation: { assistantMessage: string };
    }>();
    assert.equal(body.advisory.status, "INSUFFICIENT_BASIS");
    assert.equal(body.recommendationReference, undefined);
    assert.match(body.presentation.assistantMessage, /sufficient governed basis/iu);
    assert.equal(advisory.calls, 1);
    const replay = await app.inject({ method: "GET", url: `/api/v1/runs/${result.accepted.runId}/outcome` });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(advisory.calls, 2, "An unpersisted insufficient-basis result may be reconsidered on a later explicit read.");
    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.deepEqual(continuity.json<{ recommendations: unknown[] }>().recommendations, []);
  } finally {
    await app.close();
  }
});

class NeedsKnowledgeThenRecommendationAdvisory implements SolandraAdvisoryRuntime {
  readonly inputs: SolandraAdvisoryInput[] = [];

  async advise(input: SolandraAdvisoryInput): Promise<SolandraAdvisoryRuntimeResult> {
    this.inputs.push(structuredClone(input));
    if (input.knowledge.length === 1) {
      return {
        result: {
          status: "NEEDS_KNOWLEDGE",
          knowledgeNeeds: [SECOND_NEED],
          reason: "A second governed comparison fact is required before recommending.",
        },
        invocationProvenance: PROVENANCE,
      };
    }
    const basis = input.knowledge.map((knowledge) => {
      const claim = knowledge.findings[0];
      assert.ok(claim);
      return { knowledgeId: knowledge.knowledgeId, claimIds: [claim.claimId] };
    });
    const preserved = input.knowledge.flatMap((knowledge) => [...knowledge.uncertainties]);
    return {
      result: {
        status: "RECOMMENDATION",
        recommendation: "Prefer the option that best fits the USER's stated maintenance and reversibility objective.",
        basis,
        rationale: ["The governed findings together provide the factual comparison basis; the preference-sensitive conclusion is advisory."],
        tradeoffs: ["The recommendation is conditional on the USER's stated objective."],
        assumptions: ["The stated objective remains the controlling preference."],
        uncertainties: [...preserved],
        preservedUncertainties: [...preserved],
        alternatives: ["Keep the alternatives open if the remaining uncertainty is material."],
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

class AlwaysNeedsKnowledgeAdvisory implements SolandraAdvisoryRuntime {
  calls = 0;
  async advise(): Promise<SolandraAdvisoryRuntimeResult> {
    this.calls += 1;
    return {
      result: {
        status: "NEEDS_KNOWLEDGE",
        knowledgeNeeds: [SECOND_NEED],
        reason: "A material external comparison remains unestablished.",
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

test("M2 NEEDS_KNOWLEDGE automatically re-enters the governed M1 investigation seam before recommending", async () => {
  const acquisition = new RecordingAcquisition();
  const advisory = new NeedsKnowledgeThenRecommendationAdvisory();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
    solandraCognition: new AdvisoryCognition(),
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    const result = await advisoryTurn(app, conversationId, FIRST_USER);
    const body = result.outcome.json<{
      recommendationReference: { recommendationId: string; knowledgeIds: string[]; claimIds: string[] };
    }>();
    assert.equal(acquisition.requests.length, 2);
    assert.deepEqual(acquisition.requests[0]?.investigationQueries, [FIRST_NEED]);
    assert.deepEqual(acquisition.requests[1]?.investigationQueries, [SECOND_NEED]);
    assert.equal(advisory.inputs.length, 2);
    assert.equal(advisory.inputs[0]?.knowledge.length, 1);
    assert.equal(advisory.inputs[1]?.knowledge.length, 2);
    assert.equal(new Set(body.recommendationReference.knowledgeIds).size, 2);
    assert.equal(body.recommendationReference.knowledgeIds.length, 2);

    const continuity = await app.inject({ method: "GET", url: `/api/v1/conversations/${conversationId}/continuity` });
    assert.equal(continuity.statusCode, 200, continuity.body);
    const knowledge = continuity.json<{ knowledge: Array<{ knowledgeId: string; runId: string }> }>().knowledge;
    assert.equal(knowledge.length, 2);
    assert.equal(new Set(knowledge.map((item) => item.knowledgeId)).size, 2);
    assert.equal(new Set(knowledge.map((item) => item.runId)).size, 2);
  } finally {
    await app.close();
  }
});

test("M2 advisory Knowledge continuation is hard-bounded and fails honestly when additional governed facts remain unavailable", async () => {
  const acquisition = new RecordingAcquisition();
  const advisory = new AlwaysNeedsKnowledgeAdvisory();
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: new KnowledgeAcquisitionTruthPipeline(acquisition),
    solandraCognition: new AdvisoryCognition(),
    solandraAdvisory: advisory,
  });
  try {
    const conversationId = await createConversation(app);
    const result = await advisoryTurn(app, conversationId, FIRST_USER);
    const body = result.outcome.json<{
      advisory: { status: string; reason: string };
      recommendationReference?: unknown;
      presentation: { assistantMessage: string };
    }>();
    assert.equal(body.advisory.status, "INSUFFICIENT_BASIS");
    assert.equal(body.recommendationReference, undefined);
    assert.match(body.presentation.assistantMessage, /can't recommend responsibly/iu);
    assert.equal(acquisition.requests.length, 3, "Initial Knowledge plus exactly two bounded advisory Knowledge rounds are permitted.");
    assert.equal(advisory.calls, 3);
  } finally {
    await app.close();
  }
});

class UnsupportedFactAdvisoryProvider implements ModelProvider {
  readonly kind = "m2-unsupported-fact-advisory-provider";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    const system = request.messages[0]?.content ?? "";
    const text = system.includes("bounded grounding verifier")
      ? JSON.stringify({
        status: "NEEDS_KNOWLEDGE",
        unsupportedExternalPremises: ["The option guarantees a 99% reduction in operating cost."],
        knowledgeNeeds: ["governed evidence about operating-cost reduction"],
      })
      : JSON.stringify({
        status: "RECOMMENDATION",
        recommendation: "Prefer this option because it guarantees a 99% reduction in operating cost.",
        basis: [{ knowledgeId: "knowledge-supplied", claimIds: ["claim-supplied"] }],
        rationale: [FINDING],
        tradeoffs: [],
        assumptions: [],
        uncertainties: ["Material uncertainty remains."],
        preservedUncertainties: ["Material uncertainty remains."],
        alternatives: [],
      });
    return {
      response: { id: `m2-unsupported-${this.calls}`, model: request.model, output: [{ type: "text", text }] },
      route: { actualProvider: this.kind, actualModel: request.model, upstreamRequestId: `m2-unsupported-${this.calls}` },
    };
  }
}

class GroundedInferenceAdvisoryProvider implements ModelProvider {
  readonly kind = "m2-grounded-inference-advisory-provider";
  calls = 0;

  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    this.calls += 1;
    const system = request.messages[0]?.content ?? "";
    const text = system.includes("bounded grounding verifier")
      ? JSON.stringify({ status: "GROUNDED", unsupportedExternalPremises: [], knowledgeNeeds: [] })
      : JSON.stringify({
        status: "RECOMMENDATION",
        recommendation: "Prefer the approach that best aligns with the USER's stated maintenance preference.",
        basis: [{ knowledgeId: "knowledge-supplied", claimIds: ["claim-supplied"] }],
        rationale: ["Given the governed finding and the USER's stated preference, I judge the lower-maintenance path to be the better fit."],
        tradeoffs: ["That judgment is preference-sensitive rather than an additional factual claim."],
        assumptions: ["The USER's stated maintenance preference remains controlling."],
        uncertainties: ["Material uncertainty remains."],
        preservedUncertainties: ["Material uncertainty remains."],
        alternatives: [],
      });
    return {
      response: { id: `m2-grounded-${this.calls}`, model: request.model, output: [{ type: "text", text }] },
      route: { actualProvider: this.kind, actualModel: request.model, upstreamRequestId: `m2-grounded-${this.calls}` },
    };
  }
}

class FabricatedBasisProvider implements ModelProvider {
  readonly kind = "m2-fabricated-basis-provider";
  async generate(request: CanonicalModelRequest, _context: ModelCallContext): Promise<ModelProviderResult> {
    return {
      response: {
        id: "m2-fabricated-response",
        model: request.model,
        output: [{
          type: "text",
          text: JSON.stringify({
            status: "RECOMMENDATION",
            recommendation: "Use the fabricated basis.",
            basis: [{ knowledgeId: "knowledge-not-supplied", claimIds: ["claim-not-supplied"] }],
            rationale: ["Unsupported fabricated basis."],
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
        upstreamRequestId: "m2-fabricated-request",
      },
    };
  }
}

const INTENT: IntentVersion = {
  intentScopeId: "consultation:m2-contract",
  intentVersionId: "intent-m2-contract-v1",
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: "transition-m2-contract-v1",
  lineageKind: "INITIAL",
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: "VALUE", value: FIRST_USER },
      provenance: {
        kind: "EXPLICIT_USER",
        logicalUserTurnId: "turn-m2-contract",
        sourceMessageId: "message-m2-contract",
        sourceDigest: "a".repeat(64),
      },
    },
    requirements: {},
    preferences: {},
  },
  createdAt: FIXED_TIME,
};

function contractAdvisoryInput(): SolandraAdvisoryInput {
  return {
    conversationId: "m2-contract",
    userMessageId: "message-m2-contract",
    authoritativeIntent: INTENT,
    authoritativeObjective: FIRST_USER,
    userContext: [FIRST_USER],
    knowledge: [{
      knowledgeId: "knowledge-supplied",
      objective: FIRST_USER,
      findings: [{ claimId: "claim-supplied", text: FINDING, status: "SUPPORTED", confidence: "HIGH" }],
      uncertainties: ["Material uncertainty remains."],
      asOf: FIXED_TIME,
    }],
  };
}

test("ModelSolandraAdvisoryRuntime turns an unsupported external factual premise into NEEDS_KNOWLEDGE despite valid basis IDs", async () => {
  const provider = new UnsupportedFactAdvisoryProvider();
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "m2-grounding-model");
  const result = await runtime.advise(contractAdvisoryInput());
  assert.equal(provider.calls, 2);
  assert.equal(result.result.status, "NEEDS_KNOWLEDGE");
  if (result.result.status !== "NEEDS_KNOWLEDGE") return;
  assert.deepEqual(result.result.knowledgeNeeds, ["governed evidence about operating-cost reduction"]);
  assert.match(result.result.reason, /not established by governed Knowledge/iu);
});

test("ModelSolandraAdvisoryRuntime preserves preference-sensitive advisory inference when its external premises are grounded", async () => {
  const provider = new GroundedInferenceAdvisoryProvider();
  const runtime = new ModelSolandraAdvisoryRuntime(new ModelRuntime(provider), "m2-grounding-model");
  const result = await runtime.advise(contractAdvisoryInput());
  assert.equal(provider.calls, 2);
  assert.equal(result.result.status, "RECOMMENDATION");
  if (result.result.status !== "RECOMMENDATION") return;
  assert.match(result.result.recommendation, /USER's stated maintenance preference/iu);
  assert.match(result.result.rationale[0] ?? "", /I judge/iu);
});

test("ModelSolandraAdvisoryRuntime rejects fabricated Knowledge/claim references", async () => {
  const runtime = new ModelSolandraAdvisoryRuntime(
    new ModelRuntime(new FabricatedBasisProvider()),
    "m2-contract-model",
  );
  await assert.rejects(
    runtime.advise(contractAdvisoryInput()),
    /referenced Knowledge that Lattice did not supply/iu,
  );
});
