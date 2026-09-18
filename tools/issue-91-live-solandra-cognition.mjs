import assert from 'node:assert/strict';
import { resolveRuntimeConfig } from '../src/runtime-config.ts';
import { projectAdvisoryTransientCognition } from '../src/solandra/advisory.ts';
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
    content: 'For spare cables I can use a shallow drawer insert or a hanging pouch. The insert uses drawer space; the pouch uses wall space.',
  },
  {
    messageId: 'issue91-live-context-priority-message',
    content: 'I care most about keeping the wall clear. Using drawer space is fine.',
  },
  {
    messageId: 'issue91-live-context-followup-message',
    content: 'Which one is better?',
  },
];

const contextualCognition = await solandra.cognition.interpret({
  conversationId: 'issue91-live-context-advisory',
  messageId: contextualMessages[2].messageId,
  message: contextualMessages[2].content,
  recentUserMessages: contextualMessages.map((message) => message.content),
  recentConversation: [
    { role: 'USER', content: contextualMessages[0].content },
    {
      role: 'SOLANDRA',
      content: 'You are comparing a shallow drawer insert with a hanging pouch: the insert uses drawer space, while the pouch uses wall space.',
    },
    { role: 'USER', content: contextualMessages[1].content },
    {
      role: 'SOLANDRA',
      content: 'Keeping the wall clear is the priority you have stated, and drawer space is acceptable.',
    },
    { role: 'USER', content: contextualMessages[2].content },
  ],
  governedKnowledge: [],
  governedRecommendations: [],
});
assertLiveProvenance(contextualCognition);
assert.notEqual(contextualCognition.mode, 'CONVERSATION');
assert.equal(contextualCognition.proposal.requestedHelp, 'DECISION');
assert.equal(contextualCognition.proposal.materialAmbiguity, null);
assert.deepEqual(contextualCognition.proposal.knowledgeNeeds, []);
const transientCognition = projectAdvisoryTransientCognition(contextualCognition.proposal);
const transientText = JSON.stringify(transientCognition).toLowerCase();
assert.match(
  transientText,
  /drawer/u,
  'live cognition did not retain the drawer-insert side of the comparison in transient meaning',
);
assert.match(
  transientText,
  /pouch/u,
  'live cognition did not retain the hanging-pouch side of the comparison in transient meaning',
);
assert.match(
  transientText,
  /wall/u,
  'live cognition did not retain the USER wall-clear preference in transient meaning',
);

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
  transientCognition,
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
    transientCognition,
  },
  advisory: {
    status: contextualAdvisory.result.status,
    userPremiseMessageIds: contextualAdvisory.result.status === 'RECOMMENDATION'
      ? contextualAdvisory.result.userPremiseMessageIds
      : [],
  },
}, null, 2));
console.log('ISSUE91_LIVE_SOLANDRA_COGNITION=PASS');
