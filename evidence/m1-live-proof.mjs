import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const candidateRoot = process.env.CANDIDATE_ROOT;
const frozenSha = process.env.FROZEN_SHA;
const frozenTree = process.env.FROZEN_TREE;
assert.ok(candidateRoot, "CANDIDATE_ROOT is required");
assert.ok(frozenSha, "FROZEN_SHA is required");
assert.ok(frozenTree, "FROZEN_TREE is required");
assert.ok(process.env.GROQ_API_KEY, "GROQ_API_KEY is required");

const moduleUrl = (path) => pathToFileURL(resolve(candidateRoot, "dist", "src", path)).href;
const [{ createRuntimeApp }, { resolveRuntimeConfig }, { createConfiguredSolandraCognition }] = await Promise.all([
  import(moduleUrl("runtime-app.js")),
  import(moduleUrl("runtime-config.js")),
  import(moduleUrl("solandra/cognition-composition.js")),
]);

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: "development",
  LATTICE_TRUTH_MODE: "v36-live",
  LATTICE_SOLANDRA_COGNITION_ROUTE: "groq-gpt-oss-120b",
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: "m1-live-proof-user",
});
const configured = createConfiguredSolandraCognition(config);
assert.ok(configured, "Configured Solandra cognition is required");

const cognitionCalls = [];
const cognition = {
  async interpret(input) {
    const result = await configured.cognition.interpret(input);
    cognitionCalls.push({ input: structuredClone(input), result: structuredClone(result) });
    return result;
  },
};
const presentationCalls = [];
const presenter = {
  async present(input) {
    const result = await configured.knowledgePresenter.present(input);
    presentationCalls.push({ input: structuredClone(input), result: structuredClone(result) });
    return result;
  },
};

const PRIMARY = {
  question: "Why do banana slices turn brown after cutting?",
  sourceId: "live-banana-source",
  uri: "https://evidence.example/banana-browning",
  title: "Banana browning evidence",
  text: "After cutting, banana slices can turn brown because damaged cells expose phenolic compounds to oxygen and polyphenol oxidase catalyzes reactions that form brown pigments.",
};
const HELD_OUT = {
  question: "Why can a copper roof slowly turn green outdoors?",
  sourceId: "held-copper-source",
  uri: "https://evidence.example/copper-patina",
  title: "Copper patina evidence",
  text: "A copper roof can slowly turn green outdoors because copper reacts with oxygen, water, carbon dioxide, and other compounds to form a surface patina.",
};

function fixtureFor(objective) {
  return /copper\s+roof/iu.test(objective) ? HELD_OUT : PRIMARY;
}

const acquisitions = [];
const acquisitionProvider = {
  kind: "m1-live-proof-recording-source",
  async acquire(request) {
    const fixture = fixtureFor(request.objective);
    acquisitions.push({ request: structuredClone(request), fixture: fixture.title });
    return {
      sources: [{
        sourceId: fixture.sourceId,
        canonicalUri: fixture.uri,
        title: fixture.title,
        publisher: "M1 Evidence Fixture",
        retrievedAt: "2026-09-07T04:20:00.000Z",
        publishedAt: "2026-09-01T00:00:00.000Z",
        contentType: "text/plain",
        content: fixture.text,
      }],
      claims: [{
        claimId: `${fixture.sourceId}-claim`,
        text: fixture.text,
        claimType: "INTERPRETIVE",
        evidence: [{ sourceId: fixture.sourceId, relation: "SUPPORTS", excerpt: fixture.text }],
      }],
    };
  },
};

async function request(app, options) {
  const response = await app.inject(options);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
  return { statusCode: response.statusCode, body: response.json() };
}

async function waitForOutcome(app, runId) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const run = await request(app, { method: "GET", url: `/api/v1/runs/${runId}` });
    if (run.body.status === "FAILED" || run.body.status === "CANCELLED") {
      throw new Error(`Run ${runId} reached ${run.body.status}.`);
    }
    if (run.body.status === "COMPLETED") {
      return (await request(app, { method: "GET", url: `/api/v1/runs/${runId}/outcome` })).body;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Run ${runId} did not complete.`);
}

async function newKnowledgeTurn(app, conversationId, message) {
  const response = await request(app, {
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(response.statusCode, 202, JSON.stringify(response.body));
  assert.equal(response.body.status, "RUN_ACCEPTED", JSON.stringify(response.body));
  assert.equal(response.body.acceptedUnderstanding, message);
  assert.equal(response.body.interpretation?.authority, "NON_AUTHORITATIVE_PROPOSAL");
  assert.equal(response.body.interpretation?.requestedHelp, "KNOWLEDGE");
  assert.ok(response.body.interpretation?.knowledgeNeeds?.length > 0, "Solandra must propose at least one Knowledge need.");
  const outcome = await waitForOutcome(app, response.body.runId);
  assert.equal(outcome.outcome.kind, "KNOWLEDGE");
  assert.ok(outcome.knowledgeReference?.knowledgeId);
  assert.ok(outcome.knowledgeReference?.referenceId);
  assert.ok(outcome.presentation?.assistantMessage?.trim());
  return { accepted: response.body, outcome };
}

async function referenceTurn(app, conversationId, message) {
  const response = await request(app, {
    method: "POST",
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message },
  });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, "REFERENCE_RESOLVED", JSON.stringify(response.body));
  return response.body;
}

function publicProvenance(value) {
  return value ? {
    executionClass: value.executionClass,
    routeMode: value.routeMode,
    requestedProvider: value.requestedProvider,
    requestedModel: value.requestedModel,
    actualProvider: value.actualProvider,
    actualModel: value.actualModel,
    upstreamRequestId: value.upstreamRequestId,
    routeProvenance: value.routeProvenance,
  } : null;
}

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  knowledgeAcquisitionProvider: acquisitionProvider,
  solandraCognition: cognition,
  solandraKnowledgePresenter: presenter,
});

try {
  const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
  const conversationId = created.body.conversation.id;
  const primaryCognitionStart = cognitionCalls.length;
  const primaryAcquisitionStart = acquisitions.length;
  const primary = await newKnowledgeTurn(app, conversationId, PRIMARY.question);
  const primaryCognition = cognitionCalls[primaryCognitionStart];
  assert.ok(primaryCognition);
  assert.equal(acquisitions.length, primaryAcquisitionStart + 1);
  const primaryAcquisition = acquisitions[primaryAcquisitionStart];
  assert.ok(primaryAcquisition.request.investigationQueries?.length > 0);
  for (const query of primaryAcquisition.request.investigationQueries) {
    assert.ok(primaryCognition.result.proposal.knowledgeNeeds.includes(query));
  }
  const primaryKnowledgeId = primary.outcome.knowledgeReference.knowledgeId;
  const knowledge = (await request(app, { method: "GET", url: `/api/v1/knowledge/${primaryKnowledgeId}` })).body;
  assert.equal(knowledge.runId, primary.accepted.runId);
  assert.equal(knowledge.intentVersionId, primary.accepted.intentVersionId);
  assert.ok(knowledge.claimIds.length > 0);
  assert.ok(knowledge.sourceIds.length > 0);
  assert.ok(knowledge.evidenceIds.length > 0);
  assert.ok(knowledge.truthAssessmentIds.length > 0);

  const acquisitionBeforeSources = acquisitions.length;
  const sources = await referenceTurn(app, conversationId, "Which sources did you rely on for that?");
  assert.equal(sources.knowledgeReference.knowledgeId, primaryKnowledgeId);
  assert.equal(acquisitions.length, acquisitionBeforeSources);
  assert.match(sources.presentation.assistantMessage, /evidence\.example\/banana-browning/iu);

  const acquisitionBeforeSimplify = acquisitions.length;
  const presentationBeforeSimplify = presentationCalls.length;
  const simplified = await referenceTurn(app, conversationId, "Could you explain that in simpler terms?");
  assert.equal(simplified.knowledgeReference.knowledgeId, primaryKnowledgeId);
  assert.equal(acquisitions.length, acquisitionBeforeSimplify);
  assert.equal(presentationCalls.length, presentationBeforeSimplify + 1);
  const simplifyPresentation = presentationCalls.at(-1);

  const heldCreated = await request(app, { method: "POST", url: "/api/v1/conversations" });
  const heldConversationId = heldCreated.body.conversation.id;
  const heldCognitionStart = cognitionCalls.length;
  const heldAcquisitionStart = acquisitions.length;
  const held = await newKnowledgeTurn(app, heldConversationId, HELD_OUT.question);
  const heldCognition = cognitionCalls[heldCognitionStart];
  assert.ok(heldCognition);
  assert.equal(acquisitions.length, heldAcquisitionStart + 1);
  const heldAcquisition = acquisitions[heldAcquisitionStart];
  assert.ok(heldAcquisition.request.investigationQueries?.length > 0);
  for (const query of heldAcquisition.request.investigationQueries) {
    assert.ok(heldCognition.result.proposal.knowledgeNeeds.includes(query));
  }

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    frozenCandidate: { sha: frozenSha, tree: frozenTree },
    configuredModel: configured.model,
    liveJourney: {
      userInput: PRIMARY.question,
      cognition: {
        proposal: primaryCognition.result.proposal,
        provenance: publicProvenance(primaryCognition.result.invocationProvenance),
      },
      proposedKnowledgeNeeds: primaryCognition.result.proposal.knowledgeNeeds,
      actualInvestigation: primaryAcquisition.request,
      intentVersionId: primary.accepted.intentVersionId,
      runId: primary.accepted.runId,
      knowledgeId: primaryKnowledgeId,
      knowledgeLinkage: {
        claimIds: knowledge.claimIds,
        sourceIds: knowledge.sourceIds,
        evidenceIds: knowledge.evidenceIds,
        truthAssessmentIds: knowledge.truthAssessmentIds,
      },
      assistantResult: primary.outcome.presentation.assistantMessage,
      establishedReferenceId: primary.outcome.knowledgeReference.referenceId,
      sourceFollowUp: {
        message: "Which sources did you rely on for that?",
        knowledgeId: sources.knowledgeReference.knowledgeId,
        referenceId: sources.knowledgeReference.referenceId,
        acquisitionCountBefore: acquisitionBeforeSources,
        acquisitionCountAfter: acquisitions.length - 1,
        assistantResult: sources.presentation.assistantMessage,
      },
      transformationFollowUp: {
        message: "Could you explain that in simpler terms?",
        knowledgeId: simplified.knowledgeReference.knowledgeId,
        referenceId: simplified.knowledgeReference.referenceId,
        acquisitionCountBefore: acquisitionBeforeSimplify,
        acquisitionCountAfter: acquisitionBeforeSimplify,
        presenterStatus: simplifyPresentation?.result.status ?? null,
        presenterProvenance: publicProvenance(simplifyPresentation?.result.invocationProvenance),
        assistantResult: simplified.presentation.assistantMessage,
      },
    },
    heldOutProbe: {
      userInput: HELD_OUT.question,
      cognition: {
        proposal: heldCognition.result.proposal,
        provenance: publicProvenance(heldCognition.result.invocationProvenance),
      },
      actualInvestigation: heldAcquisition.request,
      intentVersionId: held.accepted.intentVersionId,
      runId: held.accepted.runId,
      knowledgeId: held.outcome.knowledgeReference.knowledgeId,
      assistantResult: held.outcome.presentation.assistantMessage,
      classification: "CONNECTED_PIPELINE_PASS",
    },
  }, null, 2)}\n`);
} finally {
  await app.close();
}
