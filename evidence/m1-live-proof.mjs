import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const EXPECTED_FROZEN_SHA = "959d5e8de51395e1ed4dc8e9fed28729543234b3";
const EXPECTED_FROZEN_TREE = "c30cce49a76c4fadbc1505b8a2c3374bfbe3e2ee";
const candidateRoot = process.env.CANDIDATE_ROOT;
const frozenSha = process.env.FROZEN_SHA;
const frozenTree = process.env.FROZEN_TREE;
assert.ok(candidateRoot, "CANDIDATE_ROOT is required");
assert.equal(frozenSha, EXPECTED_FROZEN_SHA, "Evidence workflow must target the authorized frozen SHA.");
assert.equal(frozenTree, EXPECTED_FROZEN_TREE, "Evidence workflow must target the authorized frozen tree.");
assert.ok(process.env.GROQ_API_KEY, "GROQ_API_KEY is required");

const actualSha = execFileSync("git", ["-C", candidateRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const actualTree = execFileSync("git", ["-C", candidateRoot, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
assert.equal(actualSha, EXPECTED_FROZEN_SHA, "Checked-out Product SHA differs from the frozen candidate.");
assert.equal(actualTree, EXPECTED_FROZEN_TREE, "Checked-out Product tree differs from the frozen candidate.");

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
  label: "banana",
  question: "Why do banana slices turn brown after cutting?",
  sourceId: "live-banana-source",
  uri: "https://evidence.example/banana-browning",
  title: "Banana browning evidence",
  text: "After cutting, banana slices can turn brown because damaged cells expose phenolic compounds to oxygen and polyphenol oxidase catalyzes reactions that form brown pigments.",
};
const HELD_OUT = {
  label: "copper-roof-held-out",
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
  assert.ok(
    response.body.interpretation?.requestedHelp === "KNOWLEDGE"
      || response.body.interpretation?.requestedHelp === "FRESH_RESEARCH",
    `Ordinary new Knowledge work may be classified as KNOWLEDGE or FRESH_RESEARCH: ${JSON.stringify(response.body.interpretation)}`,
  );
  assert.ok(
    response.body.interpretation?.knowledgeNeeds?.length > 0,
    "Solandra must propose at least one Knowledge need before the Product can investigate.",
  );
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

function assertGovernedKnowledge(knowledge, accepted) {
  assert.equal(knowledge.knowledgeId, accepted.outcome.knowledgeReference.knowledgeId);
  assert.equal(knowledge.runId, accepted.accepted.runId);
  assert.equal(knowledge.intentVersionId, accepted.accepted.intentVersionId);
  assert.ok(knowledge.claimIds.length > 0, "Governed Knowledge must retain admitted claim linkage.");
  assert.ok(knowledge.sourceIds.length > 0, "Governed Knowledge must retain admitted source linkage.");
  assert.ok(knowledge.evidenceIds.length > 0, "Governed Knowledge must retain admitted evidence linkage.");
  assert.ok(knowledge.truthAssessmentIds.length > 0, "Governed Knowledge must retain truth-assessment linkage.");
  assert.equal(knowledge.outcome.kind, "KNOWLEDGE");

  const findingsByClaim = new Map(knowledge.outcome.findings.map((finding) => [finding.claimId, finding]));
  for (const claimId of knowledge.claimIds) assert.ok(findingsByClaim.has(claimId), `Missing governed finding ${claimId}.`);

  const evidenceById = new Map((knowledge.outcome.evidence ?? []).map((item) => [item.evidenceId, item]));
  const sourceIds = new Set(knowledge.outcome.provenance.map((source) => source.sourceId));
  for (const evidenceId of knowledge.evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    assert.ok(evidence, `Missing admitted evidence ${evidenceId}.`);
    assert.equal(evidence.admitted, true, `Evidence ${evidenceId} must remain admitted.`);
    assert.ok(knowledge.claimIds.includes(evidence.claimId), `Evidence ${evidenceId} must bind an admitted claim.`);
    assert.ok(knowledge.sourceIds.includes(evidence.sourceId), `Evidence ${evidenceId} must bind an admitted source.`);
  }
  for (const sourceId of knowledge.sourceIds) assert.ok(sourceIds.has(sourceId), `Missing governed provenance source ${sourceId}.`);
}

async function runKnowledgeJourney(app, fixture) {
  const created = await request(app, { method: "POST", url: "/api/v1/conversations" });
  const conversationId = created.body.conversation.id;

  const cognitionStart = cognitionCalls.length;
  const acquisitionStart = acquisitions.length;
  const accepted = await newKnowledgeTurn(app, conversationId, fixture.question);
  assert.equal(cognitionCalls.length, cognitionStart + 1, "One live cognition proposal must drive the new Knowledge turn.");
  const cognitionCall = cognitionCalls[cognitionStart];
  assert.ok(cognitionCall);
  assert.equal(acquisitions.length, acquisitionStart + 1, "New Knowledge work must perform exactly one acquisition.");
  const acquisition = acquisitions[acquisitionStart];
  assert.ok(acquisition);
  assert.equal(acquisition.request.objective, fixture.question, "Acquisition must retain canonical USER objective wording.");
  assert.ok(acquisition.request.investigationQueries?.length > 0, "Acquisition requires non-empty investigation queries.");
  assert.deepEqual(
    acquisition.request.investigationQueries,
    cognitionCall.result.proposal.knowledgeNeeds,
    "The non-authoritative Knowledge needs must reach acquisition unchanged as investigation queries.",
  );

  const knowledgeId = accepted.outcome.knowledgeReference.knowledgeId;
  const before = (await request(app, { method: "GET", url: `/api/v1/knowledge/${knowledgeId}` })).body;
  assertGovernedKnowledge(before, accepted);

  const acquisitionBeforeSources = acquisitions.length;
  const sourceCognitionStart = cognitionCalls.length;
  const sources = await referenceTurn(app, conversationId, "Which sources did you rely on for that?");
  assert.equal(cognitionCalls.length, sourceCognitionStart + 1);
  const sourceCognition = cognitionCalls[sourceCognitionStart];
  assert.equal(sourceCognition.result.proposal.requestedHelp, "SOURCES_REFERENCE");
  assert.equal(sourceCognition.result.proposal.referencedKnowledgeId, knowledgeId);
  assert.equal(sources.knowledgeReference.knowledgeId, knowledgeId);
  assert.equal(acquisitions.length, acquisitionBeforeSources, "Historical source traversal must cause zero reacquisition.");
  assert.ok(sources.presentation.assistantMessage.includes(fixture.uri));
  const acquisitionAfterSources = acquisitions.length;

  const acquisitionBeforeTransformation = acquisitions.length;
  const presentationBeforeTransformation = presentationCalls.length;
  const transformationCognitionStart = cognitionCalls.length;
  const transformed = await referenceTurn(app, conversationId, "Could you explain that in simpler terms?");
  assert.equal(cognitionCalls.length, transformationCognitionStart + 1);
  const transformationCognition = cognitionCalls[transformationCognitionStart];
  assert.ok(
    transformationCognition.result.proposal.requestedHelp === "EXPLAIN_REFERENCE"
      || transformationCognition.result.proposal.requestedHelp === "SIMPLIFY_REFERENCE",
    `Referential presentation may be explanation or simplification: ${transformationCognition.result.proposal.requestedHelp}`,
  );
  assert.equal(transformationCognition.result.proposal.referencedKnowledgeId, knowledgeId);
  assert.equal(transformed.knowledgeReference.knowledgeId, knowledgeId);
  assert.equal(acquisitions.length, acquisitionBeforeTransformation, "Referential presentation must cause zero reacquisition.");
  assert.equal(presentationCalls.length, presentationBeforeTransformation + 1);
  const transformationPresentation = presentationCalls.at(-1);
  assert.equal(transformationPresentation?.result.status, "PRESENTED", "The real presenter must return a faithful same-Knowledge presentation.");
  assert.ok(transformed.presentation.assistantMessage?.trim());
  const acquisitionAfterTransformation = acquisitions.length;

  const after = (await request(app, { method: "GET", url: `/api/v1/knowledge/${knowledgeId}` })).body;
  assert.deepEqual(after, before, "Historical references and model presentation must not mutate established Knowledge.");

  return {
    label: fixture.label,
    userInput: fixture.question,
    acceptedUnderstanding: accepted.accepted.acceptedUnderstanding,
    cognition: {
      proposal: cognitionCall.result.proposal,
      provenance: publicProvenance(cognitionCall.result.invocationProvenance),
    },
    canonicalIntentVersionId: accepted.accepted.intentVersionId,
    runId: accepted.accepted.runId,
    proposedKnowledgeNeeds: cognitionCall.result.proposal.knowledgeNeeds,
    actualAcquisition: {
      providerKind: acquisitionProvider.kind,
      request: acquisition.request,
      fixture: acquisition.fixture,
      countBefore: acquisitionStart,
      countAfter: acquisitions.length,
    },
    knowledgeId,
    knowledgeLinkage: {
      claimIds: before.claimIds,
      sourceIds: before.sourceIds,
      evidenceIds: before.evidenceIds,
      truthAssessmentIds: before.truthAssessmentIds,
    },
    assistantResult: accepted.outcome.presentation.assistantMessage,
    establishedReferenceId: accepted.outcome.knowledgeReference.referenceId,
    historicalSourceReference: {
      cognition: {
        proposal: sourceCognition.result.proposal,
        provenance: publicProvenance(sourceCognition.result.invocationProvenance),
      },
      knowledgeId: sources.knowledgeReference.knowledgeId,
      referenceId: sources.knowledgeReference.referenceId,
      acquisitionCountBefore: acquisitionBeforeSources,
      acquisitionCountAfter: acquisitionAfterSources,
      assistantResult: sources.presentation.assistantMessage,
    },
    explanationOrSimplification: {
      cognition: {
        proposal: transformationCognition.result.proposal,
        provenance: publicProvenance(transformationCognition.result.invocationProvenance),
      },
      knowledgeId: transformed.knowledgeReference.knowledgeId,
      referenceId: transformed.knowledgeReference.referenceId,
      acquisitionCountBefore: acquisitionBeforeTransformation,
      acquisitionCountAfter: acquisitionAfterTransformation,
      presenterStatus: transformationPresentation?.result.status ?? null,
      presenterProvenance: publicProvenance(transformationPresentation?.result.invocationProvenance),
      assistantResult: transformed.presentation.assistantMessage,
    },
    originalKnowledgeUnchanged: true,
  };
}

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  knowledgeAcquisitionProvider: acquisitionProvider,
  solandraCognition: cognition,
  solandraKnowledgePresenter: presenter,
});

try {
  const liveJourney = await runKnowledgeJourney(app, PRIMARY);
  const heldOutProbe = await runKnowledgeJourney(app, HELD_OUT);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    frozenCandidate: {
      expectedSha: EXPECTED_FROZEN_SHA,
      expectedTree: EXPECTED_FROZEN_TREE,
      checkedOutSha: actualSha,
      checkedOutTree: actualTree,
    },
    configuredModel: configured.model,
    liveJourney,
    heldOutProbe: {
      ...heldOutProbe,
      classification: "CONNECTED_PRODUCT_SPINE_PASS",
    },
    refinementDebt: "KNOWLEDGE and FRESH_RESEARCH are internal cognition classifications; either is accepted only when identical governed new-Knowledge behavior is observed.",
  }, null, 2)}\n`);
} finally {
  await app.close();
}
