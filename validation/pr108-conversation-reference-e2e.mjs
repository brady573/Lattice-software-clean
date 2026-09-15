import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRuntimeApp } from '../product/src/runtime-app.ts';
import { resolveRuntimeConfig } from '../product/src/runtime-config.ts';
import { requireConfiguredSolandraCognition } from '../product/src/solandra/cognition-composition.ts';
import { requiredProofObligations } from '../product/src/truth/contracts.ts';
import { OfflineFixtureTruthPipeline } from '../product/src/truth/execution-pipeline.ts';

const FINDING = 'Stable identifiers help preserve exact relationships across software restarts when the identifiers and their governed bindings are durably retained.';
const initialMessage = 'Please find trustworthy external sources about whether stable identifiers help preserve continuity across software restarts, and summarize the supported evidence.';
const followupMessage = 'Can you show me the source behind what you just told me?';

const truthPipeline = new OfflineFixtureTruthPipeline({
  evidence: [{
    id: 'pr108-live-evidence',
    value: FINDING,
    sourceId: 'pr108-live-source',
    sourceLabel: 'PR 108 live governed source',
    admitted: true,
  }],
  truthClaims: [{
    id: 'pr108-live-claim',
    text: FINDING,
    claimType: 'FACTUAL',
    evidenceIds: ['pr108-live-evidence'],
    scope: 'consultation',
    checks: Object.fromEntries(requiredProofObligations('FACTUAL').map((kind) => [kind, 'PASSED'])),
    materiallyMisleading: false,
  }],
  truthEvidence: [{
    evidenceId: 'pr108-live-evidence',
    claimId: 'pr108-live-claim',
    provenanceComponentKey: 'pr108-live-source',
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
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: 'pr108-live-user',
  LATTICE_SOLANDRA_COGNITION_ROUTE: 'groq-gpt-oss-120b',
  GROQ_API_KEY: process.env.GROQ_API_KEY,
});
const solandra = requireConfiguredSolandraCognition(config);
const calls = [];
const recordingCognition = {
  async interpret(input) {
    const result = await solandra.cognition.interpret(input);
    calls.push({ input: structuredClone(input), result: structuredClone(result) });
    return result;
  },
};

const app = await createRuntimeApp(config, {
  memoryDispatchDelayMs: 1,
  truthPipeline,
  solandraCognition: recordingCognition,
  solandraAdvisory: solandra.advisory,
  solandraActionPreparer: solandra.actionPreparer,
  solandraKnowledgePresenter: solandra.knowledgePresenter,
});

async function waitForCompletion(runId) {
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

try {
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
  assert.equal(initialBody.interpretation.requestedHelp, 'KNOWLEDGE');
  await waitForCompletion(initialBody.runId);

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
  assert.ok(produced);
  assert.deepEqual(produced.targets, [{
    kind: 'KNOWLEDGE',
    relation: 'PRODUCED',
    targetId: knowledgeReference.knowledgeId,
  }]);

  const followup = await app.inject({
    method: 'POST',
    url: `/api/v1/conversations/${conversationId}/turns`,
    payload: { turnId: randomUUID(), message: followupMessage },
  });
  assert.equal(followup.statusCode, 200, followup.body);
  const followupBody = followup.json();
  assert.equal(followupBody.status, 'REFERENCE_RESOLVED');
  assert.equal(followupBody.interpretation.requestedHelp, 'SOURCES_REFERENCE');
  assert.equal(followupBody.interpretation.referencedKnowledgeId, knowledgeReference.knowledgeId);
  assert.equal(followupBody.knowledgeReference.knowledgeId, knowledgeReference.knowledgeId);

  const liveFollowupCall = calls.at(-1);
  assert.ok(liveFollowupCall);
  assert.deepEqual(
    liveFollowupCall.input.governedKnowledge.map((item) => item.knowledgeId),
    [knowledgeReference.knowledgeId],
  );
  const provenance = liveFollowupCall.result.invocationProvenance;
  assert.equal(provenance.actualProvider, 'groq');
  assert.equal(provenance.actualModel, 'openai/gpt-oss-120b');
  assert.equal(provenance.routeProvenance, 'COMPLETE');

  const after = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${conversationId}/continuity`,
  });
  assert.equal(after.statusCode, 200, after.body);
  const afterBody = after.json();
  const consumed = afterBody.conversationReferences.find((reference) =>
    reference.referenceId === followupBody.knowledgeReference.referenceId);
  assert.ok(consumed);
  assert.deepEqual(consumed.targets, [{
    kind: 'KNOWLEDGE',
    relation: 'CONSUMED',
    targetId: knowledgeReference.knowledgeId,
  }]);
  assert.equal(consumed.intentVersionId, followupBody.intentVersionId);
  const followupUserMessage = afterBody.messages.find((message) =>
    message.role === 'USER' && message.content === followupMessage);
  assert.ok(followupUserMessage);
  assert.equal(consumed.userMessageId, followupUserMessage.id);
  assert.equal(consumed.parentReferenceId, produced.referenceId);
  assert.equal(afterBody.recommendations.length, 0);
  assert.equal(afterBody.acceptedChoices.length, 0);

  console.log(JSON.stringify({
    productSha: process.env.EXPECTED_PRODUCT_SHA,
    productTree: process.env.EXPECTED_PRODUCT_TREE,
    model: solandra.model,
    initialRequestedHelp: initialBody.interpretation.requestedHelp,
    followupRequestedHelp: followupBody.interpretation.requestedHelp,
    knowledgeId: knowledgeReference.knowledgeId,
    producedReferenceId: produced.referenceId,
    consumedReferenceId: consumed.referenceId,
    actualProvider: provenance.actualProvider,
    actualModel: provenance.actualModel,
    routeProvenance: provenance.routeProvenance,
    recommendationCount: afterBody.recommendations.length,
    acceptedChoiceCount: afterBody.acceptedChoices.length,
  }, null, 2));
  console.log('PR108_CONVERSATION_REFERENCE_E2E=PASS');
} finally {
  await app.close();
}
