import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntimeApp } from '../product/src/runtime-app.ts';
import { resolveRuntimeConfig } from '../product/src/runtime-config.ts';
import { requireConfiguredSolandraCognition } from '../product/src/solandra/cognition-composition.ts';
import { requiredProofObligations } from '../product/src/truth/contracts.ts';
import { OfflineFixtureTruthPipeline } from '../product/src/truth/execution-pipeline.ts';

const FINDING = 'Stable identifiers help preserve exact relationships across software restarts when the identifiers and their governed bindings are durably retained.';
const SOURCE_ID = 'pr109-live-source';
const SOURCE_URI = `fixture://${SOURCE_ID}`;
const SOURCE_PUBLISHER = 'Lattice deterministic fixture';
const initialMessage = 'Please find trustworthy external sources about whether stable identifiers help preserve continuity across software restarts, and summarize the supported evidence.';
const journeys = [
  {
    name: 'unseen ordinary provenance request',
    followupMessage: 'Where can I see the evidence source you used for that answer?',
  },
  {
    name: 'canary source request',
    followupMessage: 'Can you show me the source behind what you just told me?',
  },
];

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: 'pr109-live-evidence',
    value: FINDING,
    sourceId: SOURCE_ID,
    sourceLabel: 'PR 109 live governed source',
    admitted: true,
  }],
  truthClaims: [{
    id: 'pr109-live-claim',
    text: FINDING,
    claimType: 'FACTUAL',
    evidenceIds: ['pr109-live-evidence'],
    scope: 'consultation',
    checks: Object.fromEntries(requiredProofObligations('FACTUAL').map((kind) => [kind, 'PASSED'])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: 'pr109-live-evidence',
    claimId: 'pr109-live-claim',
    provenanceComponentKey: SOURCE_ID,
    provenanceConfidence: 'HIGH',
    relation: 'SUPPORTS',
    sourceAccepted: true,
    authoritativePrimary: true,
    verification: 'VERIFIED',
  }],
});

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: 'development',
  LATTICE_TRUTH_MODE: 'v36-offline',
  LATTICE_AUTHENTICATION_MODE: 'development-fixture',
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: 'pr109-live-user',
  LATTICE_SOLANDRA_COGNITION_ROUTE: 'groq-gpt-oss-120b',
  GROQ_API_KEY: process.env.GROQ_API_KEY,
});
const solandra = requireConfiguredSolandraCognition(config);
const cognitionCalls = [];
const presentationCalls = [];
const recordingCognition = {
  async interpret(input) {
    const result = await solandra.cognition.interpret(input);
    cognitionCalls.push({ input: structuredClone(input), result: structuredClone(result) });
    return result;
  },
};
const recordingPresenter = {
  async present(input) {
    const result = await solandra.knowledgePresenter.present(input);
    presentationCalls.push({ input: structuredClone(input), result: structuredClone(result) });
    return result;
  },
};

function assertCompleteGroqProvenance(provenance, label) {
  assert.ok(provenance, `${label}: invocation provenance is required`);
  assert.equal(provenance.actualProvider, 'groq', `${label}: actual provider`);
  assert.equal(provenance.actualModel, 'openai/gpt-oss-120b', `${label}: actual model`);
  assert.equal(provenance.routeProvenance, 'COMPLETE', `${label}: route provenance`);
}

async function waitForCompletion(app, runId) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/runs/${runId}` });
    assert.equal(response.statusCode, 200, response.body);
    const status = response.json().status;
    if (status === 'COMPLETED') return;
    if (status === 'FAILED' || status === 'CANCELLED') throw new Error(`Run reached ${status}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Live historical-Knowledge Run did not complete.');
}

async function runJourney(app, journey) {
  const cognitionStart = cognitionCalls.length;
  const presentationStart = presentationCalls.length;

  const created = await app.inject({ method: 'POST', url: '/api/v1/conversations' });
  assert.equal(created.statusCode, 201, created.body);
  const conversationId = created.json().conversation.id;

  const initial = await app.inject({
    method: 'POST',
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: initialMessage },
  });
  assert.equal(initial.statusCode, 202, initial.body);
  const initialBody = initial.json();
  assert.equal(initialBody.status, 'RUN_ACCEPTED');
  const initialRequestedHelp = initialBody.interpretation.requestedHelp;
  await waitForCompletion(app, initialBody.runId);

  const outcome = await app.inject({ method: 'GET', url: `/api/v1/runs/${initialBody.runId}/outcome` });
  assert.equal(outcome.statusCode, 200, outcome.body);
  const knowledgeReference = outcome.json().knowledgeReference;
  assert.ok(knowledgeReference.knowledgeId);
  assert.ok(knowledgeReference.referenceId);

  const before = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${conversationId}/continuity`,
  });
  assert.equal(before.statusCode, 200, before.body);
  const beforeBody = before.json();
  assert.equal(Object.prototype.hasOwnProperty.call(beforeBody, 'references'), false);
  const produced = beforeBody.conversationReferences.find((reference) =>
    reference.referenceId === knowledgeReference.referenceId);
  assert.ok(produced, `${journey.name}: produced ConversationReference`);
  assert.deepEqual(produced.targets, [{
    kind: 'KNOWLEDGE',
    relation: 'PRODUCED',
    targetId: knowledgeReference.knowledgeId,
  }]);
  const runCountBefore = beforeBody.runs.length;
  assert.equal(runCountBefore, 1, `${journey.name}: exactly one initial Knowledge Run`);

  const establishedKnowledge = outcome.json().outcome;
  const admittedSource = establishedKnowledge.provenance.find((source) => source.canonicalUri === SOURCE_URI);
  assert.ok(admittedSource, `${journey.name}: exact admitted source must be in established Knowledge`);
  assert.equal(admittedSource.publisher, SOURCE_PUBLISHER);

  const followup = await app.inject({
    method: 'POST',
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: journey.followupMessage },
  });
  assert.equal(followup.statusCode, 200, followup.body);
  const followupBody = followup.json();
  assert.equal(followupBody.status, 'REFERENCE_RESOLVED');
  assert.equal(followupBody.interpretation.referencedKnowledgeId, knowledgeReference.knowledgeId);
  assert.equal(followupBody.knowledgeReference.knowledgeId, knowledgeReference.knowledgeId);
  assert.equal(followupBody.knowledge.kind, 'KNOWLEDGE');
  assert.ok(
    followupBody.knowledge.provenance.some((source) => source.canonicalUri === SOURCE_URI),
    `${journey.name}: response must retain exact governed provenance`,
  );
  assert.match(followupBody.presentation.assistantMessage, new RegExp(SOURCE_URI.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(followupBody.presentation.assistantMessage, new RegExp(SOURCE_PUBLISHER, 'u'));

  const journeyCognitionCalls = cognitionCalls.slice(cognitionStart);
  const initialCall = journeyCognitionCalls.find((call) =>
    call.input.conversationId === conversationId && call.input.message === initialMessage);
  assert.ok(initialCall, `${journey.name}: real initial cognition call`);
  assertCompleteGroqProvenance(initialCall.result.invocationProvenance, `${journey.name} initial cognition`);

  const followupCall = [...journeyCognitionCalls].reverse().find((call) =>
    call.input.conversationId === conversationId && call.input.message === journey.followupMessage);
  assert.ok(followupCall, `${journey.name}: real follow-up cognition call`);
  assert.deepEqual(
    followupCall.input.governedKnowledge.map((item) => item.knowledgeId),
    [knowledgeReference.knowledgeId],
    `${journey.name}: cognition receives only exact ConversationReference-governed Knowledge`,
  );
  assertCompleteGroqProvenance(followupCall.result.invocationProvenance, `${journey.name} cognition`);

  const journeyPresentationCalls = presentationCalls.slice(presentationStart);
  const followupPresentationCall = [...journeyPresentationCalls].reverse().find((call) =>
    call.input.knowledgeId === knowledgeReference.knowledgeId
    && call.input.userMessageId !== produced.userMessageId);
  if (followupPresentationCall) {
    assertCompleteGroqProvenance(
      followupPresentationCall.result.invocationProvenance,
      `${journey.name} knowledge presentation`,
    );
  }

  const after = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${conversationId}/continuity`,
  });
  assert.equal(after.statusCode, 200, after.body);
  const afterBody = after.json();
  assert.equal(afterBody.runs.length, runCountBefore, `${journey.name}: historical reference must not start fresh research`);
  const consumed = afterBody.conversationReferences.find((reference) =>
    reference.referenceId === followupBody.knowledgeReference.referenceId);
  assert.ok(consumed, `${journey.name}: consumed ConversationReference`);
  assert.deepEqual(consumed.targets, [{
    kind: 'KNOWLEDGE',
    relation: 'CONSUMED',
    targetId: knowledgeReference.knowledgeId,
  }]);
  assert.equal(consumed.intentVersionId, followupBody.intentVersionId);
  assert.equal(consumed.parentReferenceId, produced.referenceId);
  const followupUserMessage = afterBody.messages.find((message) =>
    message.role === 'USER' && message.content === journey.followupMessage);
  assert.ok(followupUserMessage, `${journey.name}: exact USER message lineage`);
  assert.equal(consumed.userMessageId, followupUserMessage.id);
  assert.equal(afterBody.recommendations.length, 0);
  assert.equal(afterBody.acceptedChoices.length, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(followupBody, 'recommendationReference'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(followupBody, 'acceptedChoice'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(followupBody, 'authorization'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(followupBody, 'execution'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(followupBody, 'receipt'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(followupBody, 'verification'), false);

  return {
    name: journey.name,
    initialRequestedHelp,
    followupMessage: journey.followupMessage,
    requestedHelp: followupBody.interpretation.requestedHelp,
    conversationId,
    knowledgeId: knowledgeReference.knowledgeId,
    sourceUri: SOURCE_URI,
    sourcePublisher: SOURCE_PUBLISHER,
    producedReferenceId: produced.referenceId,
    consumedReferenceId: consumed.referenceId,
    followupUserMessageId: followupUserMessage.id,
    intentVersionId: consumed.intentVersionId,
    parentReferenceId: consumed.parentReferenceId,
    runCountBefore,
    runCountAfter: afterBody.runs.length,
    actualProvider: followupCall.result.invocationProvenance.actualProvider,
    actualModel: followupCall.result.invocationProvenance.actualModel,
    routeProvenance: followupCall.result.invocationProvenance.routeProvenance,
    presenterStatus: followupPresentationCall?.result.status ?? null,
    presenterActualProvider: followupPresentationCall?.result.invocationProvenance.actualProvider ?? null,
    presenterActualModel: followupPresentationCall?.result.invocationProvenance.actualModel ?? null,
    presenterRouteProvenance: followupPresentationCall?.result.invocationProvenance.routeProvenance ?? null,
    recommendationCount: afterBody.recommendations.length,
    acceptedChoiceCount: afterBody.acceptedChoices.length,
  };
}

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline,
  solandraCognition: recordingCognition,
  solandraAdvisory: solandra.advisory,
  solandraActionPreparer: solandra.actionPreparer,
  solandraKnowledgePresenter: recordingPresenter,
});

try {
  const results = [];
  for (const journey of journeys) results.push(await runJourney(app, journey));
  console.log(JSON.stringify({
    productSha: process.env.EXPECTED_PRODUCT_SHA,
    productTree: process.env.EXPECTED_PRODUCT_TREE,
    configuredModel: solandra.model,
    journeys: results,
  }, null, 2));
  console.log('PR109_HISTORICAL_PROVENANCE_E2E=PASS');
} finally {
  await app.close();
}
