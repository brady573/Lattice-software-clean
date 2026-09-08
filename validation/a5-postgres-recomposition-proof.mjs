import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = async (path) => await import(pathToFileURL(resolve(process.cwd(), path)).href);
const [
  { createRuntimeApp },
  { resolveRuntimeConfig },
  { OfflineFixtureTruthPipeline },
  { requiredProofObligations },
  { PostgresRunStore },
  { executePersistedRun },
] = await Promise.all([
  load("dist/src/runtime-app.js"),
  load("dist/src/runtime-config.js"),
  load("dist/src/truth/execution-pipeline.js"),
  load("dist/src/truth/contracts.js"),
  load("dist/src/postgres-run-store.js"),
  load("dist/src/run-execution.js"),
]);

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required.");
const OWNER = { "x-a5-subject": "a5-pg-owner" };
const OTHER = { "x-a5-subject": "a5-pg-other" };
const FINDING = "The inspection note reports visible water staining on the ceiling beside the living-room window.";
const KNOWLEDGE_MESSAGE = "What does the inspection note establish about the visible water staining?";
const RESOURCE_MESSAGE = "Draft a short message to my landlord asking them to inspect the visible water staining, using what we established.";
const UNCERTAIN_MESSAGE = "Continue investigating the visible water staining without changing my objective.";
const CORRECTION_MESSAGE = "Actually, focus on the visible water staining beside the living-room window.";
const CANCEL_MESSAGE = "Continue investigating the inspection note before I decide what to do next.";
const PROVENANCE = Object.freeze({
  executionClass: "LOCAL_OFFLINE",
  routeMode: "PINNED",
  requestedProvider: "a5-deterministic",
  requestedModel: "a5-deterministic-model",
  actualProvider: "a5-deterministic",
  actualModel: "a5-deterministic-model",
  brokerIdentity: null,
  brokerVersion: null,
  upstreamRequestId: "a5-deterministic-request",
  routeProvenance: "COMPLETE",
});

const interpretiveChecks = Object.fromEntries(requiredProofObligations("INTERPRETIVE").map((kind) => [
  kind,
  kind === "LITERAL_FACT" || kind === "INTERPRETATION_SEPARATION" ? "PASSED" : "UNRESOLVED",
]));
const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: "a5-evidence",
    value: FINDING,
    sourceId: "a5-inspection-source",
    sourceLabel: "A5 governed inspection note",
    admitted: true,
  }],
  truthClaims: [{
    id: "a5-claim",
    text: FINDING,
    claimType: "INTERPRETIVE",
    evidenceIds: ["a5-evidence"],
    scope: "consultation",
    checks: interpretiveChecks,
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: "a5-evidence",
    claimId: "a5-claim",
    provenanceComponentKey: "a5-inspection-source",
    provenanceConfidence: "HIGH",
    relation: "SUPPORTS",
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: "VERIFIED",
  }],
});

class A5Cognition {
  async interpret(input) {
    const isResource = /\bdraft\b/iu.test(input.message);
    const isCorrection = /^actually\b/iu.test(input.message.trim());
    return {
      proposal: {
        objectiveRelation: isCorrection ? "CORRECTION" : input.currentObjective ? "CONTINUE" : "NEW_OBJECTIVE",
        proposedObjective: isCorrection ? input.message.trim() : null,
        requestedHelp: isResource ? "RESOURCE" : "KNOWLEDGE",
        relevantContext: [],
        entities: ["visible water staining"],
        referents: [],
        constraints: [],
        preferences: [],
        knowledgeNeeds: isResource ? [] : ["inspection note evidence"],
        materialAmbiguity: null,
        referencedKnowledgeId: null,
        referencedRecommendationId: null,
      },
      invocationProvenance: PROVENANCE,
    };
  }
}

class A5Preparer {
  calls = 0;
  async prepare(input) {
    this.calls += 1;
    const knowledge = input.knowledge[0];
    assert.ok(knowledge, "PreparedResource must receive prior governed Knowledge.");
    const finding = knowledge.findings[0];
    assert.ok(finding, "PreparedResource must receive a governed finding.");
    return {
      result: {
        status: "PREPARED",
        body: `Dear Landlord,\n\nThe inspection note reports visible water staining on the ceiling beside the living-room window. Could you please inspect this issue?\n\nThank you.`,
        basis: [{ knowledgeId: knowledge.knowledgeId, claimIds: [finding.claimId] }],
        preservedUncertainties: [...knowledge.uncertainties],
      },
      generationProvenance: PROVENANCE,
      groundingProvenance: PROVENANCE,
    };
  }
}

const cognition = new A5Cognition();
const preparer = new A5Preparer();
const subjectResolver = (request) => {
  const raw = request.headers["x-a5-subject"];
  return typeof raw === "string" && raw.trim() ? { subjectId: raw } : undefined;
};

function config(autoMigrate) {
  return resolveRuntimeConfig({
    DATABASE_URL: databaseUrl,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: String(autoMigrate),
    LATTICE_AUTHENTICATION_MODE: "required",
  });
}

async function appFor(autoMigrate) {
  return await createRuntimeApp(config(autoMigrate), {
    truthPipeline,
    solandraCognition: cognition,
    solandraActionPreparer: preparer,
    authenticatedSubjectResolver: subjectResolver,
  });
}

async function request(app, method, url, payload, headers = OWNER) {
  const response = await app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  return { response, body: (() => { try { return response.json(); } catch { return null; } })() };
}

async function createConversation(app) {
  const { response, body } = await request(app, "POST", "/api/v1/conversations");
  assert.equal(response.statusCode, 201, response.body);
  return body.conversation.id;
}

async function turn(app, conversationId, turnId, message) {
  return await request(app, "POST", `/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`, { turnId, message });
}

async function execute(store, runId) {
  const run = await executePersistedRun(store, truthPipeline, runId);
  assert.equal(run.status, "COMPLETED", `Expected ${runId} to complete.`);
  return run;
}

async function outcome(app, runId) {
  const { response, body } = await request(app, "GET", `/api/v1/runs/${encodeURIComponent(runId)}/outcome`);
  assert.equal(response.statusCode, 200, response.body);
  return body;
}

async function continuity(app, conversationId, headers = OWNER) {
  return await request(app, "GET", `/api/v1/conversations/${encodeURIComponent(conversationId)}/continuity`, undefined, headers);
}

async function hydrateLatestResource(app, conversationId) {
  const presentation = await request(app, "GET", `/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation`);
  assert.equal(presentation.response.statusCode, 200, presentation.response.body);
  const snapshot = presentation.body.presentation;
  const descriptor = [...snapshot.resources].reverse().find((item) => item.kind === "generated_artifact");
  assert.ok(descriptor, "Expected latest generated Composer resource.");
  assert.equal(descriptor.editable, true);
  assert.equal(descriptor.executionAuthorized, false);
  const hydrated = await request(
    app,
    "GET",
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation/resources/${encodeURIComponent(descriptor.id)}?presentationRevision=${encodeURIComponent(snapshot.presentationRevision)}`,
  );
  assert.equal(hydrated.response.statusCode, 200, hydrated.response.body);
  assert.equal(hydrated.body.resource.descriptor.editable, true);
  assert.equal(hydrated.body.resource.descriptor.executionAuthorized, false);
  return hydrated.body.resource;
}

let app;
let store;
let conversationId;
let knowledgeRun;
let knowledgeId;
let knowledgeClaimId;
let preparedRun;
let prepared;
let preparedHydrated;
let uncertainFirst;
let countsBeforeUncertain;
try {
  app = await appFor(true);
  store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  conversationId = await createConversation(app);

  const knowledgeTurn = await turn(app, conversationId, "a5-pg-knowledge", KNOWLEDGE_MESSAGE);
  assert.equal(knowledgeTurn.response.statusCode, 202, knowledgeTurn.response.body);
  knowledgeRun = knowledgeTurn.body.runId;
  await execute(store, knowledgeRun);
  const knowledgeResult = await outcome(app, knowledgeRun);
  assert.equal(knowledgeResult.outcome.kind, "KNOWLEDGE");
  knowledgeId = knowledgeResult.knowledgeReference.knowledgeId;
  const knowledge = await request(app, "GET", `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}`);
  assert.equal(knowledge.response.statusCode, 200, knowledge.response.body);
  assert.equal(knowledge.body.knowledgeId, knowledgeId);
  assert.equal(knowledge.body.outcome.findings.length, 1);
  assert.equal(knowledge.body.outcome.findings[0].status, "UNRESOLVED");
  knowledgeClaimId = knowledge.body.outcome.findings[0].claimId;
  assert.ok(knowledge.body.outcome.uncertainties.length > 0);
  const admitted = knowledge.body.outcome.evidence.filter((item) =>
    item.claimId === knowledgeClaimId && item.admitted === true && item.verification === "VERIFIED");
  assert.ok(admitted.length > 0);
  const sourceIds = new Set(knowledge.body.outcome.provenance.map((item) => item.sourceId));
  assert.ok(admitted.every((item) => sourceIds.has(item.sourceId)));

  const resourceTurn = await turn(app, conversationId, "a5-pg-resource", RESOURCE_MESSAGE);
  assert.equal(resourceTurn.response.statusCode, 202, resourceTurn.response.body);
  preparedRun = resourceTurn.body.runId;
  await execute(store, preparedRun);
  prepared = await outcome(app, preparedRun);
  assert.equal(prepared.outcome.kind, "ACTION_PREPARATION");
  assert.equal(prepared.outcome.resource.kind, "PREPARED_MESSAGE");
  assert.equal(prepared.outcome.resource.editable, true);
  assert.equal(prepared.outcome.resource.executionAuthorized, false);
  assert.equal(prepared.preparationReference.editable, true);
  assert.equal(prepared.preparationReference.executionAuthorized, false);
  assert.deepEqual(prepared.preparationReference.knowledgeIds, [knowledgeId]);
  assert.deepEqual(prepared.preparationReference.claimIds, [knowledgeClaimId]);
  assert.ok(prepared.outcome.resource.preservedUncertainties.length > 0);
  assert.ok(knowledge.body.outcome.uncertainties.every((item) => prepared.outcome.resource.preservedUncertainties.includes(item)));
  assert.equal(preparer.calls, 1);
  preparedHydrated = await hydrateLatestResource(app, conversationId);
  assert.equal(preparedHydrated.payload.text, prepared.outcome.resource.body);

  const before = await continuity(app, conversationId);
  assert.equal(before.response.statusCode, 200, before.response.body);
  countsBeforeUncertain = { messages: before.body.messages.length, runs: before.body.runs.length };

  await store.close(); store = undefined;
  await app.close(); app = undefined;

  // First recomposition must restore the exact prepared state without recomputation.
  app = await appFor(false);
  store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const replayPrepared = await outcome(app, preparedRun);
  assert.equal(replayPrepared.preparationReference.resourceId, prepared.preparationReference.resourceId);
  assert.equal(replayPrepared.outcome.resource.body, prepared.outcome.resource.body);
  assert.deepEqual(replayPrepared.outcome.resource.basis, prepared.outcome.resource.basis);
  assert.deepEqual(replayPrepared.outcome.resource.preservedUncertainties, prepared.outcome.resource.preservedUncertainties);
  assert.equal(replayPrepared.outcome.resource.editable, true);
  assert.equal(replayPrepared.outcome.resource.executionAuthorized, false);
  assert.equal(preparer.calls, 1, "PreparedResource replay must not recompute preparation.");
  const replayHydrated = await hydrateLatestResource(app, conversationId);
  assert.equal(replayHydrated.payload.text, preparedHydrated.payload.text);

  // Simulate an accepted submission whose response the browser cannot trust.
  uncertainFirst = await turn(app, conversationId, "a5-pg-uncertain", UNCERTAIN_MESSAGE);
  assert.equal(uncertainFirst.response.statusCode, 202, uncertainFirst.response.body);
  const acceptedContinuity = await continuity(app, conversationId);
  assert.equal(acceptedContinuity.body.messages.length, countsBeforeUncertain.messages + 1);
  assert.equal(acceptedContinuity.body.runs.length, countsBeforeUncertain.runs + 1);
  assert.equal(acceptedContinuity.body.runs.at(-1).runId, uncertainFirst.body.runId);
  assert.equal(acceptedContinuity.body.runs.at(-1).status, "CREATED");

  await store.close(); store = undefined;
  await app.close(); app = undefined;

  // Recompose while the accepted Run is still active, then retry the exact logical turn.
  app = await appFor(false);
  store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const activeContinuity = await continuity(app, conversationId);
  assert.equal(activeContinuity.body.runs.at(-1).runId, uncertainFirst.body.runId);
  assert.equal(activeContinuity.body.runs.at(-1).status, "CREATED");
  const uncertainReplay = await turn(app, conversationId, "a5-pg-uncertain", UNCERTAIN_MESSAGE);
  assert.equal(uncertainReplay.response.statusCode, 202, uncertainReplay.response.body);
  assert.equal(uncertainReplay.body.runId, uncertainFirst.body.runId);
  assert.equal(uncertainReplay.body.intentVersionId, uncertainFirst.body.intentVersionId);
  assert.equal(uncertainReplay.body.provenance.messageId, uncertainFirst.body.provenance.messageId);
  const replayContinuity = await continuity(app, conversationId);
  assert.equal(replayContinuity.body.messages.length, countsBeforeUncertain.messages + 1);
  assert.equal(replayContinuity.body.runs.length, countsBeforeUncertain.runs + 1);
  await execute(store, uncertainReplay.body.runId);
  await outcome(app, uncertainReplay.body.runId);

  // An ordinary correction after recomposition must create a new IntentVersion through existing authority semantics.
  const correction = await turn(app, conversationId, "a5-pg-correction", CORRECTION_MESSAGE);
  assert.equal(correction.response.statusCode, 202, correction.response.body);
  assert.notEqual(correction.body.intentVersionId, uncertainReplay.body.intentVersionId);
  await execute(store, correction.body.runId);
  await outcome(app, correction.body.runId);
  const correctedContinuity = await continuity(app, conversationId);
  const correctedRun = correctedContinuity.body.runs.find((item) => item.runId === correction.body.runId);
  assert.equal(correctedRun.exactBinding.intentVersionId, correction.body.intentVersionId);
  const correctedPresentation = await request(app, "GET", `/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation`);
  assert.equal(correctedPresentation.response.statusCode, 200, correctedPresentation.response.body);
  assert.equal(correctedPresentation.body.presentation.basis.intentVersionId, correction.body.intentVersionId);
  assert.equal(correctedPresentation.body.presentation.resources.some((item) => item.id === `action-preparation:${preparedRun}`), false,
    "Stale prepared material must not remain the current presentation after a material correction.");

  // Cancellation is durable and cannot be crossed by later execution.
  const cancelTurn = await turn(app, conversationId, "a5-pg-cancel", CANCEL_MESSAGE);
  assert.equal(cancelTurn.response.statusCode, 202, cancelTurn.response.body);
  const cancel = await request(app, "POST", `/api/v1/runs/${encodeURIComponent(cancelTurn.body.runId)}/cancel`);
  assert.equal(cancel.response.statusCode, 202, cancel.response.body);
  assert.equal(cancel.body.status, "CANCELLED");

  await store.close(); store = undefined;
  await app.close(); app = undefined;

  app = await appFor(false);
  store = await PostgresRunStore.connect(databaseUrl, { migrate: false });
  const cancelled = await request(app, "GET", `/api/v1/runs/${encodeURIComponent(cancelTurn.body.runId)}`);
  assert.equal(cancelled.response.statusCode, 200, cancelled.response.body);
  assert.equal(cancelled.body.status, "CANCELLED");
  const afterExecutionAttempt = await executePersistedRun(store, truthPipeline, cancelTurn.body.runId);
  assert.equal(afterExecutionAttempt.status, "CANCELLED");

  // Existing ownership boundary must protect recovery and control APIs.
  const foreignContinuity = await continuity(app, conversationId, OTHER);
  assert.equal(foreignContinuity.response.statusCode, 404);
  const foreignRun = await request(app, "GET", `/api/v1/runs/${encodeURIComponent(cancelTurn.body.runId)}`, undefined, OTHER);
  assert.equal(foreignRun.response.statusCode, 404);
  const foreignCancel = await request(app, "POST", `/api/v1/runs/${encodeURIComponent(cancelTurn.body.runId)}/cancel`, undefined, OTHER);
  assert.equal(foreignCancel.response.statusCode, 404);
  const foreignPresentation = await request(app, "GET", `/api/v1/conversations/${encodeURIComponent(conversationId)}/presentation`, undefined, OTHER);
  assert.equal(foreignPresentation.response.statusCode, 404);

  // Earlier authoritative state remains exactly inspectable after all recovery operations.
  const finalKnowledge = await request(app, "GET", `/api/v1/knowledge/${encodeURIComponent(knowledgeId)}`);
  assert.equal(finalKnowledge.response.statusCode, 200, finalKnowledge.response.body);
  assert.equal(finalKnowledge.body.outcome.findings[0].status, "UNRESOLVED");
  assert.deepEqual(finalKnowledge.body.outcome.uncertainties, knowledge.body.outcome.uncertainties);
  const finalPrepared = await outcome(app, preparedRun);
  assert.equal(finalPrepared.preparationReference.resourceId, prepared.preparationReference.resourceId);
  assert.deepEqual(finalPrepared.outcome.resource.basis, prepared.outcome.resource.basis);
  assert.deepEqual(finalPrepared.outcome.resource.preservedUncertainties, prepared.outcome.resource.preservedUncertainties);
  assert.equal(finalPrepared.outcome.resource.executionAuthorized, false);
  assert.equal(preparer.calls, 1);

  console.log(`A5_PG_CONVERSATION_ID=${conversationId}`);
  console.log(`A5_PG_KNOWLEDGE_RUN_ID=${knowledgeRun}`);
  console.log(`A5_PG_KNOWLEDGE_ID=${knowledgeId}`);
  console.log(`A5_PG_KNOWLEDGE_CLAIM_ID=${knowledgeClaimId}`);
  console.log("A5_PG_KNOWLEDGE_STATUS=UNRESOLVED");
  console.log(`A5_PG_PREPARED_RUN_ID=${preparedRun}`);
  console.log(`A5_PG_PREPARED_RESOURCE_ID=${prepared.preparationReference.resourceId}`);
  console.log(`A5_PG_PREPARED_INTENT_VERSION_ID=${prepared.preparationReference.intentVersionId}`);
  console.log(`A5_PG_UNCERTAIN_RUN_ID=${uncertainFirst.body.runId}`);
  console.log(`A5_PG_UNCERTAIN_TURN_ID=a5-pg-uncertain`);
  console.log(`A5_PG_PREPARER_CALLS=${preparer.calls}`);
  console.log("A5_PG_RECOMPOSITION=PASS");
  console.log("A5_PG_CANCELLATION_DURABLE=PASS");
  console.log("A5_PG_SUBJECT_ISOLATION=PASS");
  console.log("A5_POSTGRES_PRODUCT_PROOF=PASS");
} finally {
  await store?.close();
  await app?.close();
}
