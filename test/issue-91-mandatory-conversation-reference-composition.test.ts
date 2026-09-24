import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { registerConversationContinuityApi } from "../src/conversation/continuity-api.js";
import type { ConversationContinuityApiOptions } from "../src/conversation/continuity-api.js";
import type {
  ConversationReferenceRecord,
  ConversationReferenceStore,
} from "../src/conversation/conversation-reference-store.js";
import { isProducedConversationTarget } from "../src/conversation/governed-reference-admission.js";
import { registerConsultationIntake } from "../src/consultation-intake.js";
import type { ConsultationIntakeOptions } from "../src/consultation-intake.js";
import type { ModelInvocationProvenance } from "../src/model/types.js";
import { createRuntimeApp } from "../src/runtime-app.js";
import { resolveRuntimeConfig } from "../src/runtime-config.js";
import type {
  SolandraCognitionInput,
  SolandraCognitionResult,
  SolandraCognitiveRuntime,
  SolandraSemanticProposal,
} from "../src/solandra/cognition.js";
import { requiredProofObligations } from "../src/truth/contracts.js";
import { OfflineFixtureTruthPipeline } from "../src/truth/execution-pipeline.js";

/**
 * Issue #91 / F1: ConversationReference is mandatory canonical Product
 * infrastructure. Missing infrastructure is a composition/configuration
 * failure, never a legitimate empty-reference or empty-governed-history state.
 */

const PROVENANCE: ModelInvocationProvenance = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "issue-91-f1-cognition",
  requestedModel: "issue-91-f1-model",
  actualProvider: "issue-91-f1-cognition",
  actualModel: "issue-91-f1-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "issue-91-f1-request",
  routeProvenance: "COMPLETE",
});

const FINDING = "A governed finding is only visible when its exact produced reference is durable.";
const SOURCE_ID = "issue91-f1-source";

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "issue91-f1-evidence",
    value: FINDING,
    sourceId: SOURCE_ID,
    sourceLabel: "Issue 91 F1 governed source",
    admitted: true,
  }],
  truthClaims: [{
    id: "issue91-f1-claim",
    text: FINDING,
    claimType: "FACTUAL",
    evidenceIds: ["issue91-f1-evidence"],
    scope: "consultation",
    checks: Object.fromEntries(requiredProofObligations("FACTUAL").map((kind) => [kind, "PASSED"])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "issue91-f1-evidence",
    claimId: "issue91-f1-claim",
    provenanceComponentKey: SOURCE_ID,
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-offline",
} as NodeJS.ProcessEnv);

function proposal(input: Partial<SolandraSemanticProposal> = {}): SolandraSemanticProposal {
  return {
    objectiveRelation: "NEW_OBJECTIVE",
    proposedObjective: null,
    requestedHelp: "KNOWLEDGE",
    relevantContext: [],
    entities: [],
    referents: [],
    constraints: [],
    preferences: [],
    knowledgeNeeds: ["Whether governed visibility requires a durable produced reference"],
    materialAmbiguity: null,
    referencedKnowledgeId: null,
    referencedRecommendationId: null,
    referencedOptionId: null,
    proposedNextStep: "INVESTIGATE",
    ...input,
  };
}

class EstablishingCognition implements SolandraCognitiveRuntime {
  async interpret(_input: SolandraCognitionInput): Promise<SolandraCognitionResult> {
    return { proposal: proposal(), invocationProvenance: PROVENANCE };
  }
}

/** A store that cannot record: reference failure must never be silently ignored. */
function failingReferenceStore(): ConversationReferenceStore {
  return {
    kind: "memory",
    async putReference(_reference: ConversationReferenceRecord): Promise<ConversationReferenceRecord> {
      throw new Error("conversation reference infrastructure unavailable");
    },
    async getReference() { return undefined; },
    async listByConversation() { return []; },
    async latestReference() { return undefined; },
    async close() {},
  };
}

async function waitForCompletion(app: FastifyInstance, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json<{ status: string }>().status;
    if (status === "COMPLETED") return;
    if (status === "FAILED" || status === "CANCELLED") throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Governed Knowledge Run did not complete.");
}

test("canonical consultation intake rejects a composition without ConversationReference infrastructure", async () => {
  const app = Fastify();
  // The cast models an untyped/JavaScript composition: the type boundary already
  // forbids omission, and this runtime guard is the fail-closed defense.
  const omitted = {
    intentStore: {} as never,
    conversationStore: {} as never,
    conversationResponseStore: {} as never,
    userMessageStore: {} as never,
    apiControlStore: {} as never,
    runStore: {} as never,
  } as unknown as ConsultationIntakeOptions;
  assert.throws(
    () => registerConsultationIntake(app, omitted),
    /requires ConversationReference infrastructure/u,
    "canonical consultation composition must reject omitted ConversationReference infrastructure",
  );
  await app.close();
});

test("canonical conversation continuity rejects a composition without ConversationReference infrastructure", async () => {
  const app = Fastify();
  const omitted = {
    conversationStore: {} as never,
    conversationResponseStore: {} as never,
    userMessageStore: {} as never,
    runStore: {} as never,
    runIndexStore: {} as never,
    decisionPlanStore: {} as never,
  } as unknown as ConversationContinuityApiOptions;
  assert.throws(
    () => registerConversationContinuityApi(app, omitted),
    /requires ConversationReference infrastructure/u,
    "canonical continuity composition must reject omitted ConversationReference infrastructure",
  );
  await app.close();
});

test("ordinary non-governed conversation remains usable and reports truthful empty governed history", async () => {
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: new EstablishingCognition(),
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    const body = continuity.json<{
      conversationReferences: unknown[];
      knowledge: unknown[];
      recommendations: unknown[];
      acceptedChoices: unknown[];
      runs: unknown[];
    }>();
    assert.deepEqual(body.conversationReferences, [], "no governed turn means no references, not missing infrastructure");
    assert.deepEqual(body.knowledge, []);
    assert.deepEqual(body.recommendations, []);
    assert.deepEqual(body.acceptedChoices, []);
    assert.deepEqual(body.runs, []);
  } finally {
    await app.close();
  }
});

test("a governed turn is not acknowledged as persisted when exact reference recording fails", async () => {
  const app = await createRuntimeApp(config, {
    memoryDispatchDelayMs: 1,
    truthPipeline,
    solandraCognition: new EstablishingCognition(),
    conversationReferenceStore: failingReferenceStore(),
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/v1/conversations" });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;

    const turn = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/turns`,
      payload: { turnId: randomUUID(), message: "Please establish the governed finding for this conversation." },
    });
    assert.equal(turn.statusCode, 202, turn.body);
    const runId = turn.json<{ runId: string }>().runId;
    await waitForCompletion(app, runId);

    const outcome = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
    assert.notEqual(outcome.statusCode, 200, "governed outcome must fail closed when its reference cannot be recorded");

    const continuity = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversationId}/continuity`,
    });
    assert.equal(continuity.statusCode, 200, continuity.body);
    assert.deepEqual(continuity.json<{ conversationReferences: unknown[] }>().conversationReferences, []);
  } finally {
    await app.close();
  }
});

test("governed visibility still requires the exact produced reference identity", async () => {
  const references: ConversationReferenceRecord[] = [];
  const store: ConversationReferenceStore = {
    kind: "memory",
    async putReference(reference) { references.push(reference); return reference; },
    async getReference(referenceId) { return references.find((item) => item.referenceId === referenceId); },
    async listByConversation() { return [...references]; },
    async latestReference() { return references.at(-1); },
    async close() {},
  };

  assert.equal(await isProducedConversationTarget(store, "conversation-1", "KNOWLEDGE", "knowledge-unknown"), false);
  references.push({
    referenceId: "reference-1",
    conversationId: "conversation-1",
    userMessageId: "message-1",
    responseId: "run:run-1:outcome",
    intentVersionId: "intent-version-1",
    targets: [{ kind: "KNOWLEDGE", targetId: "knowledge-1", relation: "PRODUCED" }],
    parentReferenceId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(await isProducedConversationTarget(store, "conversation-1", "KNOWLEDGE", "knowledge-1"), true);
  assert.equal(await isProducedConversationTarget(store, "conversation-1", "KNOWLEDGE", "knowledge-other"), false);
  assert.equal(
    await isProducedConversationTarget(store, "conversation-1", "RECOMMENDATION", "knowledge-1"),
    false,
    "a Knowledge reference must not admit a Recommendation identity",
  );
});
