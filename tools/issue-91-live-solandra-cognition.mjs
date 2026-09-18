import assert from 'node:assert/strict';
import { resolveRuntimeConfig } from '../src/runtime-config.ts';
import { requireConfiguredSolandraCognition } from '../src/solandra/cognition-composition.ts';

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: 'development',
  LATTICE_TRUTH_MODE: 'v36-offline',
  LATTICE_AUTHENTICATION_MODE: 'development-fixture',
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: 'issue91-live-cognition',
  LATTICE_SOLANDRA_COGNITION_ROUTE: 'groq-gpt-oss-120b',
  GROQ_API_KEY: process.env.GROQ_API_KEY,
});
const solandra = requireConfiguredSolandraCognition(config);
assert.equal(solandra.model, 'openai/gpt-oss-120b');

function assertLiveProvenance(result) {
  assert.equal(result.invocationProvenance.actualProvider, 'groq');
  assert.equal(result.invocationProvenance.actualModel, 'openai/gpt-oss-120b');
  assert.equal(result.invocationProvenance.routeProvenance, 'COMPLETE');
}

const contextualMessages = [
  {
    messageId: 'issue91-live-context-option-message',
    content: 'I am choosing between Alder and Brook storage bins. Alder is the one I can stack; Brook is the one I cannot stack.',
  },
  {
    messageId: 'issue91-live-context-priority-message',
    content: 'My only priority is stackability; I do not care about color or price.',
  },
  {
    messageId: 'issue91-live-context-followup-message',
    content: 'I need to decide now. Which option best fits that priority?',
  },
];

const contextualCognition = await solandra.cognition.interpret({
  conversationId: 'issue91-live-context-advisory',
  messageId: contextualMessages[2].messageId,
  message: contextualMessages[2].content,
  recentUserMessages: contextualMessages.map((message) => message.content),
  recentConversation: contextualMessages.map((message) => ({
    role: 'USER',
    content: message.content,
  })),
  governedKnowledge: [],
  governedRecommendations: [],
});
assertLiveProvenance(contextualCognition);
assert.notEqual(contextualCognition.mode, 'CONVERSATION');
assert.equal(contextualCognition.proposal.requestedHelp, 'DECISION');
assert.equal(contextualCognition.proposal.materialAmbiguity, null);
assert.deepEqual(contextualCognition.proposal.knowledgeNeeds, []);

const contextualIntent = {
  intentScopeId: 'consultation:issue91-live-context-advisory',
  intentVersionId: 'issue91-live-context-advisory-v1',
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: 'issue91-live-context-advisory-transition',
  lineageKind: 'INITIAL',
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: 'VALUE', value: contextualMessages[2].content },
      provenance: {
        kind: 'EXPLICIT_USER',
        logicalUserTurnId: 'issue91-live-context-followup-turn',
        sourceMessageId: contextualMessages[2].messageId,
        sourceDigest: 'b'.repeat(64),
      },
    },
    requirements: {},
    preferences: {},
  },
  createdAt: '2026-09-18T00:00:00.000Z',
};

const contextualAdvisory = await solandra.advisory.advise({
  conversationId: 'issue91-live-context-advisory',
  userMessageId: contextualMessages[2].messageId,
  authoritativeIntent: contextualIntent,
  authoritativeObjective: contextualMessages[2].content,
  userContext: contextualMessages.map((message) => message.content),
  userContextMessages: contextualMessages,
  knowledge: [],
});
assertLiveProvenance(contextualAdvisory);
assert.equal(contextualAdvisory.result.status, 'RECOMMENDATION');
assert.ok(contextualAdvisory.result.userPremiseMessageIds.includes(contextualMessages[2].messageId));
assert.ok(
  contextualAdvisory.result.userPremiseMessageIds.some((messageId) =>
    messageId === contextualMessages[0].messageId || messageId === contextualMessages[1].messageId),
  'live advisory did not retain any prior exact USER source needed to resolve the contextual follow-up',
);

console.log(JSON.stringify({
  configuredModel: solandra.model,
  cognition: {
    mode: contextualCognition.mode ?? 'GOVERNED',
    requestedHelp: contextualCognition.mode === 'CONVERSATION'
      ? null
      : contextualCognition.proposal.requestedHelp,
  },
  advisory: {
    status: contextualAdvisory.result.status,
    userPremiseMessageIds: contextualAdvisory.result.status === 'RECOMMENDATION'
      ? contextualAdvisory.result.userPremiseMessageIds
      : [],
  },
}, null, 2));
console.log('ISSUE91_LIVE_SOLANDRA_COGNITION=PASS');
