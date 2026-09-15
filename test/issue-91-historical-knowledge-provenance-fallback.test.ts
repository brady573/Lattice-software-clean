import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraRequestedHelp,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import type {
  SolandraKnowledgePresentationInput,
  SolandraKnowledgePresentationResult,
  SolandraKnowledgePresenter,
} from "../src/solandra/knowledge-presenter.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const FINDING = "Stable identifiers preserve exact relationships across a restart when the governed bindings are durably retained.";
const SOURCE_ID = "issue91-history-source";
const SOURCE_URI = `fixture://${SOURCE_ID}`;
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-91-history-cognition",
  requestedModel: "issue-91-history-model",
  actualProvider: "issue-91-history-cognition",
  actualModel: "issue-91-history-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-91-history-request",
  routeProvenance: "COMPLETE",
});

const sourcedTruthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "issue91-history-evidence",
    value: FINDING,
    sourceId: SOURCE_ID,
    sourceLabel: "Issue 91 governed history source",
    admitted: true,
  }],
  truthClaims: [{
    id: "issue91-history-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["issue91-history-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "issue91-history-evidence",
    claimId: "issue91-history-claim",
    provenanceComponentKey: SOURCE_ID,
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

const sourceEmptyTruthPipeline = new OfflineFixtureTruthPipeline({
  truthClaims: [],
  truthEvidence: [],
});

function proposal(input: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
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
    referencedOptionId: null,
    proposedNextStep: "INVESTIGATE",
    ...input,
  };
}

class TwoTurnCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  constructor(private readonly followupHelp: SolandraRequestedHelp) {}

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    if (this.inputs.length === 1) {
      return {
        proposal: proposal({
          objectiveRelation: "NEW_OBJECTIVE",
          requestedHelp: "KNOWLEDGE",
          knowledgeNeeds: ["Whether durable identifiers preserve restart continuity"],
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: "CONTINUE",
        requestedHelp: this.followupHelp,
        referencedKnowledgeId: input.governedKnowledge[0]?.knowledgeId ?? null,
        proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
      }),
      invocationProvenance: PROVENANCE,
    };
  }
}

class ScriptedPresenter implements SolandraKnowledgePresenter {
  readonly inputs: SolandraKnowledgePresentationInput[] = [];

  constructor(private readonly result: SolandraKnowledgePresentationResult) {}

  async present(input: SolandraKnowledgePresentationInput): Promise<SolandraKnowledgePresentationResult> {
    this.inputs.push(structuredClone(input));
    return structuredClone(this.result);
  }
}

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

async function createConversation(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ conversation: { id: string } }>().conversation.id;
}

async function waitForCompletion(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Issue #91 historical Knowledge Run did not complete.");
}

type ContinuityBody = {
  messages: Array<{ id: string; role: "USER" | "SOLANDRA"; content: string }>;
  runs: Array<{ runId: string }>;
  conversationReferences: Array<{
    referenceId: string;
    userMessageId: string;
    intentVersionId: string;
    parentReferenceId: string | null;
    targets: Array<{ kind: string; relation: string; targetId: string }>;
  }>;
  recommendations: unknown[];
  acceptedChoices: unknown[];
};

type EstablishedJourney = {
  conversationId: string;
  knowledgeId: string;
  producedReferenceId: string;
  runCount: number;
};

async function establishHistoricalKnowledge(app: FastifyInstance): Promise<EstablishedJourney> {
  const conversationId = await createConversation(app);
  const initial = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: {
      turnId: randomUUID(),
      message: "Please establish what the evidence says about durable identifiers and restart continuity.",
    },
  });
  assert.equal(initial.statusCode, 202, initial.body);
  const accepted = initial.json<{ status: string; runId: string }>();
  assert.equal(accepted.status, "RUN_ACCEPTED");
  await waitForCompletion(app, accepted.runId);

  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  const knowledgeReference = outcome.json<{
    knowledgeReference: { knowledgeId: string; referenceId: string };
  }>().knowledgeReference;
  assert.ok(knowledgeReference.knowledgeId);
  assert.ok(knowledgeReference.referenceId);

  const continuity = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/${conversationId}/continuity`,
  });
  assert.equal(continuity.statusCode, 200, continuity.body);
  const body = continuity.json<ContinuityBody>();
  const produced = body.conversationReferences.find((reference) =>
    reference.referenceId === knowledgeReference.referenceId);
  assert.ok(produced);
  assert.deepEqual(produced.targets, [{
    kind: "KNOWLEDGE",
    relation: "PRODUCED",
    targetId: knowledgeReference.knowledgeId,
  }]);

  return {
    conversationId,
    knowledgeId: knowledgeReference.knowledgeId,
    producedReferenceId: produced.referenceId,
    runCount: body.runs.length,
  };
}

async function assertResolvedHistoricalReference(input: {
  app: FastifyInstance;
  journey: EstablishedJourney;
  message: string;
  expectedPresentation?: string;
  expectedPresentationMatch?: RegExp;
}): Promise<{ body: Record<string, any>; continuity: ContinuityBody; consumedReferenceId: string }> {
  const response = await input.app.inject({
    method: "POST",
    url: `/api/v1/conversations/${input.journey.conversationId}/turns`,
    payload: { turnId: randomUUID(), message: input.message },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json<Record<string, any>>();
  assert.equal(body.status, "REFERENCE_RESOLVED");
  assert.equal(body.knowledgeReference.knowledgeId, input.journey.knowledgeId);
  if (input.expectedPresentation !== undefined) {
    assert.equal(body.presentation.assistantMessage, input.expectedPresentation);
  }
  if (input.expectedPresentationMatch) {
    assert.match(body.presentation.assistantMessage, input.expectedPresentationMatch);
  }

  const continuityResponse = await input.app.inject({
    method: "GET",
    url: `/api/v1/conversations/${input.journey.conversationId}/continuity`,
  });
  assert.equal(continuityResponse.statusCode, 200, continuityResponse.body);
  const continuity = continuityResponse.json<ContinuityBody>();
  assert.equal(continuity.runs.length, input.journey.runCount, "historical presentation must not start a new Knowledge Run");
  const userMessage = continuity.messages.find((message) =>
    message.role === "USER" && message.content === input.message);
  assert.ok(userMessage);
  const matchingConsumed = continuity.conversationReferences.filter((reference) =>
    reference.userMessageId === userMessage.id
    && reference.targets.some((target) =>
      target.kind === "KNOWLEDGE"
      && target.relation === "CONSUMED"
      && target.targetId === input.journey.knowledgeId));
  assert.equal(matchingConsumed.length, 1, "historical presentation must write exactly one consumed Knowledge reference");
  const consumed = matchingConsumed[0]!;
  assert.equal(consumed.referenceId, body.knowledgeReference.referenceId);
  assert.equal(consumed.intentVersionId, body.intentVersionId);
  assert.equal(consumed.parentReferenceId, input.journey.producedReferenceId);
  assert.equal(continuity.recommendations.length, 0);
  assert.equal(continuity.acceptedChoices.length, 0);
  assert.equal(Object.hasOwn(body, "recommendationReference"), false);
  assert.equal(Object.hasOwn(body, "acceptedChoice"), false);
  assert.equal(Object.hasOwn(body, "authorization"), false);
  assert.equal(Object.hasOwn(body, "execution"), false);
  assert.equal(Object.hasOwn(body, "receipt"), false);
  assert.equal(Object.hasOwn(body, "verification"), false);
  return { body, continuity, consumedReferenceId: consumed.referenceId };
}

test("Issue #91 historical SOURCES_REFERENCE keeps the existing exact source route unchanged", async () => {
  const cognition = new TwoTurnCognition("SOURCES_REFERENCE");
  const presenter = new ScriptedPresenter({
    status: "PRESENTED",
    text: "unused",
    invocationProvenance: PROVENANCE,
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourcedTruthPipeline,
    solandraCognition: cognition,
    solandraKnowledgePresenter: presenter,
  });
  try {
    const journey = await establishHistoricalKnowledge(app);
    const resolved = await assertResolvedHistoricalReference({
      app,
      journey,
      message: "Where did the evidence for that earlier result come from?",
      expectedPresentationMatch: new RegExp(SOURCE_URI.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    });
    assert.equal(resolved.body.interpretation.requestedHelp, "SOURCES_REFERENCE");
    assert.equal(presenter.inputs.length, 0);
  } finally {
    await app.close();
  }
});

test("Issue #91 successful historical explanation remains presenter-owned and unchanged", async () => {
  const cognition = new TwoTurnCognition("EXPLAIN_REFERENCE");
  const explanation = "Explanation from the exact established Knowledge.";
  const presenter = new ScriptedPresenter({
    status: "PRESENTED",
    text: explanation,
    invocationProvenance: PROVENANCE,
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourcedTruthPipeline,
    solandraCognition: cognition,
    solandraKnowledgePresenter: presenter,
  });
  try {
    const journey = await establishHistoricalKnowledge(app);
    const resolved = await assertResolvedHistoricalReference({
      app,
      journey,
      message: "Could you walk me through what that established result means?",
      expectedPresentation: explanation,
    });
    assert.equal(resolved.body.interpretation.requestedHelp, "EXPLAIN_REFERENCE");
    assert.equal(presenter.inputs.length, 1);
    assert.equal(presenter.inputs[0]?.knowledgeId, journey.knowledgeId);
  } finally {
    await app.close();
  }
});

test("Issue #91 NEEDS_NEW_KNOWLEDGE preserves existing governed provenance without starting new work", async () => {
  const cognition = new TwoTurnCognition("EXPLAIN_REFERENCE");
  const presenter = new ScriptedPresenter({
    status: "NEEDS_NEW_KNOWLEDGE",
    text: null,
    invocationProvenance: PROVENANCE,
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourcedTruthPipeline,
    solandraCognition: cognition,
    solandraKnowledgePresenter: presenter,
  });
  try {
    const journey = await establishHistoricalKnowledge(app);
    const resolved = await assertResolvedHistoricalReference({
      app,
      journey,
      message: "Can you show me the source behind what you just told me?",
      expectedPresentationMatch: /additional factual Knowledge[\s\S]*did not start new research[\s\S]*fixture:\/\/issue91-history-source/iu,
    });
    assert.equal(resolved.body.interpretation.requestedHelp, "EXPLAIN_REFERENCE");
    assert.equal(resolved.body.interpretation.referencedKnowledgeId, journey.knowledgeId);
    assert.equal(presenter.inputs[0]?.knowledgeId, journey.knowledgeId);
  } finally {
    await app.close();
  }
});

test("Issue #91 fidelity failure preserves governed provenance for an ordinary transformation request", async () => {
  const cognition = new TwoTurnCognition("SIMPLIFY_REFERENCE");
  const presenter = new ScriptedPresenter({
    status: "FIDELITY_REJECTED",
    text: null,
    invocationProvenance: PROVENANCE,
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourcedTruthPipeline,
    solandraCognition: cognition,
    solandraKnowledgePresenter: presenter,
  });
  try {
    const journey = await establishHistoricalKnowledge(app);
    const resolved = await assertResolvedHistoricalReference({
      app,
      journey,
      message: "Could you make the earlier result easier to understand without adding anything new?",
      expectedPresentationMatch: /couldn't transform the established Knowledge faithfully[\s\S]*did not start new research[\s\S]*fixture:\/\/issue91-history-source/iu,
    });
    assert.equal(resolved.body.interpretation.requestedHelp, "SIMPLIFY_REFERENCE");
    assert.equal(presenter.inputs[0]?.knowledgeId, journey.knowledgeId);
  } finally {
    await app.close();
  }
});

test("Issue #91 failed historical transformation reports absent admitted provenance faithfully", async () => {
  const cognition = new TwoTurnCognition("EXPLAIN_REFERENCE");
  const presenter = new ScriptedPresenter({
    status: "NEEDS_NEW_KNOWLEDGE",
    text: null,
    invocationProvenance: PROVENANCE,
  });
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourceEmptyTruthPipeline,
    solandraCognition: cognition,
    solandraKnowledgePresenter: presenter,
  });
  try {
    const journey = await establishHistoricalKnowledge(app);
    const resolved = await assertResolvedHistoricalReference({
      app,
      journey,
      message: "What can you faithfully show me from that earlier result and its provenance?",
      expectedPresentationMatch: /I don't have an admitted source linked to that established Knowledge/iu,
    });
    assert.equal(resolved.body.knowledgeReference.knowledgeId, journey.knowledgeId);
  } finally {
    await app.close();
  }
});
