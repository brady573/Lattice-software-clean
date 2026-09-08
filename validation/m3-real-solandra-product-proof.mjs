import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const moduleFromSubject = async (path) => await import(pathToFileURL(resolve(process.cwd(), path)).href);
const [
  { createRuntimeApp },
  { resolveRuntimeConfig },
  { createConfiguredSolandraCognition },
  { KnowledgeAcquisitionTruthPipeline },
  { PostgresRunStore },
  { executePersistedRun },
] = await Promise.all([
  moduleFromSubject("dist/src/runtime-app.js"),
  moduleFromSubject("dist/src/runtime-config.js"),
  moduleFromSubject("dist/src/solandra/cognition-composition.js"),
  moduleFromSubject("dist/src/truth/knowledge-acquisition-pipeline.js"),
  moduleFromSubject("dist/src/postgres-run-store.js"),
  moduleFromSubject("dist/src/run-execution.js"),
]);

const EXPECTED_MODEL = "openai/gpt-oss-120b";
const KNOWLEDGE_USER = "What does the inspection note establish about the visible water staining?";
const RESOURCE_USER = "Draft a short message to my landlord asking them to inspect the visible water staining, using what we established.";
const FINDING = "The inspection note reports visible water staining on the ceiling beside the living-room window.";
const FIXED_TIME = "2026-09-08T01:45:00.000Z";
const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.GROQ_API_KEY;
assert.ok(databaseUrl, "DATABASE_URL must be configured.");
assert.ok(apiKey, "GROQ_API_KEY must be configured.");

function parseModelJson(text) {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return JSON.parse(match?.[1] ?? trimmed);
}

const rawCalls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  let requestBody = null;
  if (typeof init?.body === "string") {
    try { requestBody = JSON.parse(init.body); } catch { requestBody = null; }
  }
  const response = await originalFetch(input, init);
  if (url === "https://api.groq.com/openai/v1/chat/completions") {
    let payload = null;
    try { payload = await response.clone().json(); } catch { payload = null; }
    const system = Array.isArray(requestBody?.messages)
      ? requestBody.messages.find((message) => message?.role === "system")?.content ?? ""
      : "";
    const role = system.includes("bounded grounding verifier for a prepared USER message")
      ? "PREPARATION_GROUNDING"
      : system.includes("preparing one editable message for the USER")
        ? "PREPARATION_GENERATION"
        : system.includes("semantic cognition boundary")
          ? "COGNITION"
          : system.includes("advisory reasoning boundary")
            ? "ADVISORY"
            : "OTHER";
    rawCalls.push(Object.freeze({
      role,
      model: payload?.model ?? null,
      requestId: payload?.id ?? null,
      content: payload?.choices?.[0]?.message?.content ?? null,
      status: response.status,
    }));
  }
  return response;
};

const acquisition = {
  kind: "m3-live-proof-governed-acquisition",
  requests: [],
  async acquire(request) {
    this.requests.push(structuredClone(request));
    return {
      sources: [{
        sourceId: "m3-live-proof-inspection-source",
        canonicalUri: "https://m3-live-proof.example/inspection-note",
        title: "M3 live proof inspection note",
        publisher: "M3 Live Proof Fixture",
        retrievedAt: FIXED_TIME,
        publishedAt: null,
        contentType: "text/plain",
        content: FINDING,
      }],
      claims: [{
        claimId: "m3-live-proof-inspection-claim",
        text: FINDING,
        claimType: "INTERPRETIVE",
        evidence: [{
          sourceId: "m3-live-proof-inspection-source",
          relation: "SUPPORTS",
          excerpt: FINDING,
        }],
      }],
    };
  },
};
const pipeline = new KnowledgeAcquisitionTruthPipeline(acquisition);

function config(autoMigrate) {
  return resolveRuntimeConfig({
    DATABASE_URL: databaseUrl,
    LATTICE_DEPLOYMENT_MODE: "development",
    LATTICE_TRUTH_MODE: "v36-offline",
    LATTICE_AUTO_MIGRATE: String(autoMigrate),
    LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m3-real-solandra-proof-user",
    LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
    GROQ_API_KEY: apiKey,
  });
}

async function postOrdinaryTurn(app, conversationId, message) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  if (response.statusCode !== 202) {
    throw new Error(`M3_REAL_PRODUCT_TURN_FAILURE status=${response.statusCode} body=${response.body}`);
  }
  return response.json();
}

async function executeRun(store, runId) {
  const run = await executePersistedRun(store, pipeline, runId);
  assert.equal(run.status, "COMPLETED", `Run ${runId} must complete through the ordinary Product execution path.`);
}

async function getOutcome(app, runId) {
  const response = await app.inject({ method: "GET", url: `/api/v1/runs/${runId}/outcome` });
  if (response.statusCode !== 200) {
    throw new Error(`M3_REAL_PRODUCT_OUTCOME_FAILURE status=${response.statusCode} body=${response.body}`);
  }
  return response.json();
}

async function getKnowledge(app, knowledgeId) {
  const response = await app.inject({ method: "GET", url: `/api/v1/knowledge/${knowledgeId}` });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function assertComposerResource(app, conversationId, expectedBody) {
  const presentationResponse = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/${conversationId}/presentation`,
  });
  assert.equal(presentationResponse.statusCode, 200, presentationResponse.body);
  const snapshot = presentationResponse.json().presentation;
  const descriptor = [...snapshot.resources].reverse().find((resource) =>
    resource.kind === "generated_artifact" && resource.editable === true);
  assert.ok(descriptor, "Composer presentation must expose an editable generated resource.");
  assert.equal(descriptor.executionAuthorized, false);
  const hydratedResponse = await app.inject({
    method: "GET",
    url: `/api/v1/conversations/${conversationId}/presentation/resources/${encodeURIComponent(descriptor.id)}?presentationRevision=${encodeURIComponent(snapshot.presentationRevision)}`,
  });
  assert.equal(hydratedResponse.statusCode, 200, hydratedResponse.body);
  const hydrated = hydratedResponse.json().resource;
  assert.equal(hydrated.descriptor.editable, true);
  assert.equal(hydrated.descriptor.executionAuthorized, false);
  assert.equal(hydrated.payload.text, expectedBody);
  return { presentationRevision: snapshot.presentationRevision, resourceId: descriptor.id };
}

function assertGovernedBasis(prepared, knowledge) {
  assert.ok(Array.isArray(prepared.outcome.resource.basis) && prepared.outcome.resource.basis.length > 0,
    "Real prepared material must retain an exact governed Knowledge/claim basis.");
  const findingIds = new Set(knowledge.outcome.findings.map((finding) => finding.claimId));
  const provenanceIds = new Set(knowledge.outcome.provenance.map((source) => source.sourceId));
  const evidence = knowledge.outcome.evidence ?? [];
  const matchingBasis = prepared.outcome.resource.basis.find((entry) => entry.knowledgeId === knowledge.knowledgeId);
  assert.ok(matchingBasis, "Prepared material must bind the previously established Knowledge used by the USER's request.");
  assert.ok(matchingBasis.claimIds.length > 0);
  for (const claimId of matchingBasis.claimIds) {
    assert.ok(findingIds.has(claimId), `Prepared claim ${claimId} must be an established finding of the bound Knowledge.`);
    const admitted = evidence.filter((item) =>
      item.claimId === claimId && item.admitted === true && item.verification === "VERIFIED");
    assert.ok(admitted.length > 0, `Prepared claim ${claimId} must retain admitted verified evidence.`);
    for (const item of admitted) {
      assert.ok(provenanceIds.has(item.sourceId), `Prepared claim source ${item.sourceId} must traverse to Knowledge provenance.`);
    }
  }
  for (const uncertainty of knowledge.outcome.uncertainties) {
    assert.ok(prepared.outcome.resource.preservedUncertainties.includes(uncertainty),
      "Prepared material must not discard governed Knowledge uncertainty.");
  }
}

let first;
let second;
let executionStore;
try {
  const firstConfig = config(true);
  const firstSolandra = createConfiguredSolandraCognition(firstConfig);
  assert.ok(firstSolandra, "Configured Solandra composition must exist.");
  assert.equal(firstSolandra.model, EXPECTED_MODEL);
  first = await createRuntimeApp(firstConfig, {
    truthPipeline: pipeline,
    solandraCognition: firstSolandra.cognition,
    solandraKnowledgePresenter: firstSolandra.knowledgePresenter,
    solandraAdvisory: firstSolandra.advisory,
    solandraActionPreparer: firstSolandra.actionPreparer,
  });

  const conversationResponse = await first.inject({ method: "POST", url: "/api/v1/conversations" });
  assert.equal(conversationResponse.statusCode, 201, conversationResponse.body);
  const conversationId = conversationResponse.json().conversation.id;
  executionStore = await PostgresRunStore.connect(databaseUrl, { migrate: false });

  const knowledgeTurn = await postOrdinaryTurn(first, conversationId, KNOWLEDGE_USER);
  assert.equal(knowledgeTurn.acceptedUnderstanding, KNOWLEDGE_USER);
  assert.equal(knowledgeTurn.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(knowledgeTurn.interpretation?.requestedHelp, "KNOWLEDGE");
  await executeRun(executionStore, knowledgeTurn.runId);
  const knowledgeOutcome = await getOutcome(first, knowledgeTurn.runId);
  assert.equal(knowledgeOutcome.outcome.kind, "KNOWLEDGE");
  const establishedKnowledgeId = knowledgeOutcome.knowledgeReference?.knowledgeId;
  assert.ok(establishedKnowledgeId, "The ordinary Knowledge turn must establish governed Knowledge.");
  const knowledge = await getKnowledge(first, establishedKnowledgeId);
  assert.equal(knowledge.knowledgeId, establishedKnowledgeId);
  assert.ok(knowledge.outcome.findings.some((finding) => finding.status === "SUPPORTED"));
  assert.ok(knowledge.outcome.provenance.length > 0);

  const resourceTurn = await postOrdinaryTurn(first, conversationId, RESOURCE_USER);
  assert.equal(resourceTurn.acceptedUnderstanding, RESOURCE_USER);
  assert.equal(resourceTurn.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(resourceTurn.interpretation?.requestedHelp, "RESOURCE");
  assert.ok(resourceTurn.runId);
  assert.ok(resourceTurn.intentVersionId);
  await executeRun(executionStore, resourceTurn.runId);
  const prepared = await getOutcome(first, resourceTurn.runId);
  assert.equal(prepared.outcome.kind, "ACTION_PREPARATION");
  assert.equal(prepared.outcome.resource.kind, "PREPARED_MESSAGE");
  assert.equal(prepared.outcome.resource.editable, true);
  assert.equal(prepared.outcome.resource.executionAuthorized, false);
  assert.match(prepared.outcome.resource.body, /inspect/iu);
  assert.match(prepared.outcome.resource.body, /water|staining/iu);
  assert.doesNotMatch(prepared.outcome.resource.body, /^Objective:/u);
  assert.equal(prepared.preparationReference?.intentVersionId, resourceTurn.intentVersionId);
  assert.equal(prepared.preparationReference?.editable, true);
  assert.equal(prepared.preparationReference?.executionAuthorized, false);
  assert.ok(prepared.preparationReference?.knowledgeIds.includes(establishedKnowledgeId));
  assert.ok(prepared.preparationReference?.claimIds.length > 0);
  assertGovernedBasis(prepared, knowledge);

  const generationCalls = rawCalls.filter((call) => call.role === "PREPARATION_GENERATION");
  const groundingCalls = rawCalls.filter((call) => call.role === "PREPARATION_GROUNDING");
  const cognitionCalls = rawCalls.filter((call) => call.role === "COGNITION");
  assert.ok(cognitionCalls.length >= 2, "Both ordinary USER turns must reach real configured Solandra cognition.");
  assert.equal(generationCalls.length, 1, "The real prepared resource must be generated exactly once before persistence.");
  assert.equal(groundingCalls.length, 1, "The real prepared resource must cross the bounded grounding verifier exactly once.");
  for (const call of [...cognitionCalls, ...generationCalls, ...groundingCalls]) {
    assert.equal(call.status, 200, `Real ${call.role} provider call must return HTTP 200.`);
    assert.equal(call.model, EXPECTED_MODEL, `Real ${call.role} response must prove the pinned model identity.`);
    assert.equal(typeof call.content, "string", `Real ${call.role} response must contain assistant output.`);
  }
  const generatedRaw = parseModelJson(generationCalls[0].content);
  const groundingRaw = parseModelJson(groundingCalls[0].content);
  assert.equal(generatedRaw.status, "PREPARED");
  assert.equal(groundingRaw.status, "GROUNDED");
  assert.deepEqual(groundingRaw.unsupportedExternalPremises, []);
  assert.equal(groundingRaw.materialUncertaintyPreserved, true);
  assert.equal(groundingRaw.authorityBoundaryPreserved, true);

  const composer = await assertComposerResource(first, conversationId, prepared.outcome.resource.body);
  const callsAtPersistence = rawCalls.length;
  const replay = await getOutcome(first, resourceTurn.runId);
  assert.equal(replay.preparationReference.resourceId, prepared.preparationReference.resourceId);
  assert.equal(replay.outcome.resource.body, prepared.outcome.resource.body);
  assert.equal(rawCalls.length, callsAtPersistence, "Historical prepared-resource replay must not invoke Solandra again.");

  console.log(`M3_REAL_SOLANDRA_PROVIDER_MODEL=${EXPECTED_MODEL}`);
  console.log(`M3_REAL_KNOWLEDGE_REQUEST=${JSON.stringify(KNOWLEDGE_USER)}`);
  console.log(`M3_REAL_RESOURCE_REQUEST=${JSON.stringify(RESOURCE_USER)}`);
  console.log(`M3_REAL_RESOURCE_KIND=${prepared.outcome.resource.kind}`);
  console.log(`M3_REAL_RESOURCE_BODY=${JSON.stringify(prepared.outcome.resource.body)}`);
  console.log(`M3_REAL_RESOURCE_BODY_SHA256=${createHash("sha256").update(prepared.outcome.resource.body).digest("hex")}`);
  console.log(`M3_REAL_PREPARED_RESOURCE_ID=${prepared.preparationReference.resourceId}`);
  console.log(`M3_REAL_INTENT_VERSION_ID=${prepared.preparationReference.intentVersionId}`);
  console.log(`M3_REAL_KNOWLEDGE_ID=${establishedKnowledgeId}`);
  console.log(`M3_REAL_BASIS_CLAIM_COUNT=${prepared.preparationReference.claimIds.length}`);
  console.log(`M3_REAL_PRESERVED_UNCERTAINTY_COUNT=${prepared.outcome.resource.preservedUncertainties.length}`);
  console.log(`M3_REAL_EDITABLE=${prepared.outcome.resource.editable}`);
  console.log(`M3_REAL_EXECUTION_AUTHORIZED=${prepared.outcome.resource.executionAuthorized}`);
  console.log(`M3_REAL_COMPOSER_RESOURCE_ID=${composer.resourceId}`);
  console.log(`M3_REAL_GENERATION_RAW_SHA256=${createHash("sha256").update(generationCalls[0].content).digest("hex")}`);
  console.log(`M3_REAL_GROUNDING_RAW_SHA256=${createHash("sha256").update(groundingCalls[0].content).digest("hex")}`);

  await executionStore.close();
  executionStore = undefined;
  await first.close();
  first = undefined;

  const secondConfig = config(false);
  const secondSolandra = createConfiguredSolandraCognition(secondConfig);
  assert.ok(secondSolandra);
  assert.equal(secondSolandra.model, EXPECTED_MODEL);
  second = await createRuntimeApp(secondConfig, {
    truthPipeline: pipeline,
    solandraCognition: secondSolandra.cognition,
    solandraKnowledgePresenter: secondSolandra.knowledgePresenter,
    solandraAdvisory: secondSolandra.advisory,
    solandraActionPreparer: secondSolandra.actionPreparer,
  });

  const afterRestart = await getOutcome(second, resourceTurn.runId);
  assert.equal(afterRestart.preparationReference.resourceId, prepared.preparationReference.resourceId);
  assert.equal(afterRestart.outcome.resource.body, prepared.outcome.resource.body);
  assert.equal(afterRestart.outcome.resource.executionAuthorized, false);
  await assertComposerResource(second, conversationId, prepared.outcome.resource.body);
  assert.equal(rawCalls.length, callsAtPersistence, "PostgreSQL recomposition/replay must not invoke Solandra again.");

  console.log("M3_REAL_SOLANDRA_PRODUCT_PROOF=PASS");
} catch (error) {
  for (const call of rawCalls) {
    console.error(`M3_REAL_PROOF_DIAGNOSTIC role=${call.role} status=${call.status} model=${call.model ?? "NONE"} content=${JSON.stringify(call.content)}`);
  }
  throw error;
} finally {
  globalThis.fetch = originalFetch;
  await executionStore?.close();
  await first?.close();
  await second?.close();
}
