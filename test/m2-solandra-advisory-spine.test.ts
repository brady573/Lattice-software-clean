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
      }],
      claims: [{
        claimId: `m2-${suffix}-claim`,
        text,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: `m2-${suffix}-source`, relation: "SUPPORTS", excerpt: text }],
      }],
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
  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
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
      knowledgeIds: string[];
      claimIds: string[];
      uncertainties: string[];
      selectionAuthorized: boolean;
    }>();
    assert.equal(recommendationRecord.conversationId, conversationId);
    assert.equal(recommendationRecord.runId, first.accepted.runId);
    assert.equal(recommendationRecord.intentVersionId, first.accepted.intentVersionId);
    assert.equal(recommendationRecord.selectionAuthorized, false);
    assert.deepEqual(recommendationRecord.knowledgeIds, firstBody.recommendationReference.knowledgeIds);
    assert.deepEqual(recommendationRecord.claimIds, firstBody.recommendationReference.claimIds);
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
    assert.match(sourceBody.presentation.assistantMessage, /https:\/\/m2\.example\/first/iu);
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

test("ModelSolandraAdvisoryRuntime rejects fabricated Knowledge/claim references", async () => {
  const runtime = new ModelSolandraAdvisoryRuntime(
    new ModelRuntime(new FabricatedBasisProvider()),
    "m2-contract-model",
  );
  await assert.rejects(
    runtime.advise({
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
    }),
    /referenced Knowledge that Lattice did not supply/iu,
  );
});
