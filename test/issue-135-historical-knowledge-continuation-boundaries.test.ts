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
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

const FINDING = "Stable identifiers preserve exact relationships across a restart when the governed bindings are durably retained.";
const SOURCE_ID = "issue135-history-source";
const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-135-history-cognition",
  requestedModel: "issue-135-history-model",
  actualProvider: "issue-135-history-cognition",
  actualModel: "issue-135-history-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-135-history-request",
  routeProvenance: "COMPLETE",
});

const sourcedTruthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "issue135-history-evidence",
    value: FINDING,
    sourceId: SOURCE_ID,
    sourceLabel: "Issue 135 governed history source",
    admitted: true,
  }],
  truthClaims: [{
    id: "issue135-history-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["issue135-history-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "issue135-history-evidence",
    claimId: "issue135-history-claim",
    provenanceComponentKey: SOURCE_ID,
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
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

/**
 * First turn establishes governed Knowledge. Every later turn proposes the
 * configured historical-reference help, binding either the exact admitted
 * Knowledge or an explicit override.
 */
class ReferenceCognition implements SolandraCognitiveRuntime {
  readonly inputs: SolandraCognitionInput[] = [];

  constructor(
    private readonly followupHelp: SolandraRequestedHelp,
    private readonly referencedKnowledgeId: (admitted: string | undefined) => string | null,
    private readonly firstTurnRequestedHelp: SolandraRequestedHelp = "KNOWLEDGE",
  ) {}

  async interpret(input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    this.inputs.push(structuredClone(input));
    if (this.inputs.length === 1) {
      return {
        proposal: proposal({
          objectiveRelation: "NEW_OBJECTIVE",
          requestedHelp: this.firstTurnRequestedHelp,
          knowledgeNeeds: ["Whether durable identifiers preserve restart continuity"],
          ...(this.firstTurnRequestedHelp === "KNOWLEDGE" ? {} : {
            referencedKnowledgeId: this.referencedKnowledgeId(input.governedKnowledge[0]?.knowledgeId),
            proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
          }),
        }),
        invocationProvenance: PROVENANCE,
      };
    }
    return {
      proposal: proposal({
        objectiveRelation: "CONTINUE",
        requestedHelp: this.followupHelp,
        referencedKnowledgeId: this.referencedKnowledgeId(input.governedKnowledge[0]?.knowledgeId),
        proposedNextStep: "REFERENCE_EXISTING_KNOWLEDGE",
      }),
      invocationProvenance: PROVENANCE,
    };
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
  throw new Error("Issue #135 historical Knowledge Run did not complete.");
}

type ContinuityBody = {
  runs: Array<{ runId: string }>;
  conversationReferences: Array<{
    referenceId: string;
    targets: Array<{ kind: string; relation: string; targetId: string }>;
  }>;
};

async function establishHistoricalKnowledge(app: FastifyInstance): Promise<{ conversationId: string; runCount: number }> {
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
  // The canonical outcome read is what completes governed Knowledge persistence
  // and its exact PRODUCED ConversationReference as one conversational operation.
  const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${accepted.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  assert.ok(outcome.json<{ knowledgeReference?: { knowledgeId?: string } }>().knowledgeReference?.knowledgeId);
  // The governed object and its exact PRODUCED ConversationReference complete as
  // one conversational operation; wait for that relationship, not the Run alone.
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const continuity = await continuityOf(app, conversationId);
    const produced = continuity.conversationReferences.some((reference) =>
      reference.targets.some((target) => target.kind === "KNOWLEDGE" && target.relation === "PRODUCED"));
    if (produced) return { conversationId, runCount: continuity.runs.length };
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Governed historical Knowledge never completed its produced reference.");
}

async function continuityOf(app: FastifyInstance, conversationId: string): Promise<ContinuityBody> {
  const response = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/${conversationId}/continuity`,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<ContinuityBody>();
}

test("historical reference to Knowledge that is not admitted in this conversation remains KNOWLEDGE_NOT_FOUND", async () => {
  const unadmittedKnowledgeId = `knowledge-${randomUUID()}`;
  const cognition = new ReferenceCognition("EXPLAIN_REFERENCE", () => unadmittedKnowledgeId);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourcedTruthPipeline,
    solandraCognition: cognition,
  });
  try {
    const journey = await establishHistoricalKnowledge(app);
    const before = await continuityOf(app, journey.conversationId);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${journey.conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Please walk me through the earlier result again." },
    });
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.json<{ error: string }>().error, "KNOWLEDGE_NOT_FOUND");

    const after = await continuityOf(app, journey.conversationId);
    assert.equal(after.runs.length, before.runs.length, "a rejected reference must not start a Knowledge Run");
    assert.equal(
      after.conversationReferences.filter((reference) => reference.targets.some((target) =>
        target.targetId === unadmittedKnowledgeId)).length,
      0,
      "a rejected reference must not record a ConversationReference",
    );
  } finally {
    await app.close();
  }
});

test("historical reference without an established Intent version remains GOVERNED_KNOWLEDGE_REFERENCE_UNAVAILABLE", async () => {
  const cognition = new ReferenceCognition(
    "SOURCES_REFERENCE",
    () => `knowledge-${randomUUID()}`,
    "SOURCES_REFERENCE",
  );
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourcedTruthPipeline,
    solandraCognition: cognition,
  });
  try {
    const conversationId = await createConversation(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Show me the sources for that earlier result." },
    });
    assert.equal(response.statusCode, 409, response.body);
    const body = response.json<{ error: string; message: string }>();
    assert.equal(body.error, "GOVERNED_KNOWLEDGE_REFERENCE_UNAVAILABLE");
    assert.match(body.message, /referenced governed Knowledge is not available/iu);

    const continuity = await continuityOf(app, conversationId);
    assert.equal(continuity.runs.length, 0);
    assert.equal(continuity.conversationReferences.length, 0);
  } finally {
    await app.close();
  }
});

test("historical transformation without an available presenter remains SOLANDRA_KNOWLEDGE_PRESENTATION_UNAVAILABLE", async () => {
  const cognition = new ReferenceCognition("SIMPLIFY_REFERENCE", (admitted) => admitted ?? null);
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline: sourcedTruthPipeline,
    solandraCognition: cognition,
  });
  try {
    const journey = await establishHistoricalKnowledge(app);
    const before = await continuityOf(app, journey.conversationId);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${journey.conversationId}/turns`,
      payload: {
        turnId: randomUUID(),
        message: "Could you restate the earlier established result more simply?",
      },
    });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(
      response.json<{ error: string }>().error,
      "SOLANDRA_KNOWLEDGE_PRESENTATION_UNAVAILABLE",
    );

    const after = await continuityOf(app, journey.conversationId);
    assert.equal(after.runs.length, before.runs.length, "an unavailable presenter must not start a Knowledge Run");
    assert.equal(
      after.conversationReferences.filter((reference) => reference.targets.some((target) =>
        target.relation === "CONSUMED")).length,
      0,
      "an unavailable presenter must not record a consumed continuity relationship",
    );
  } finally {
    await app.close();
  }
});
