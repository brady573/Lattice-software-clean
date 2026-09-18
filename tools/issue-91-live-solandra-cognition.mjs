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

function pendingProposal(proposalId, objective) {
  return {
    proposalId,
    proposalDigest: 'a'.repeat(64),
    operations: [JSON.stringify({
      op: 'SET',
      path: { kind: 'OBJECTIVE' },
      value: { state: 'VALUE', value: objective },
    })],
  };
}

const ordinary = await solandra.cognition.interpret({
  conversationId: 'issue91-live-cognition',
  messageId: 'issue91-live-cognition-message',
  message: 'I’m comparing two ways to keep a small local project recoverable. What tradeoffs should I think about?',
  recentUserMessages: [],
  recentConversation: [],
  governedKnowledge: [],
  governedRecommendations: [],
});
assertLiveProvenance(ordinary);

const readingProposal = pendingProposal(
  'issue91-live-reading-proposal',
  'Plan a quiet reading corner that works in a shared living room without taking over the whole space.',
);
const readingConfirmation = await solandra.cognition.interpret({
  conversationId: 'issue91-live-reading-confirmation',
  messageId: 'issue91-live-reading-confirmation-message',
  message: 'Exactly — that captures the adjustment I was trying to make.',
  currentObjective: 'Plan a quiet reading corner for my apartment.',
  recentUserMessages: [
    'Plan a quiet reading corner for my apartment.',
    'Actually, make it work in the shared living room without taking over the whole space.',
  ],
  recentConversation: [
    { role: 'USER', content: 'Plan a quiet reading corner for my apartment.' },
    { role: 'USER', content: 'Actually, make it work in the shared living room without taking over the whole space.' },
  ],
  governedKnowledge: [],
  governedRecommendations: [],
  pendingIntentProposal: readingProposal,
});
assertLiveProvenance(readingConfirmation);
assert.notEqual(readingConfirmation.mode, 'CONVERSATION');
assert.equal(readingConfirmation.proposal.requestedHelp, 'CONFIRM_INTENT');
assert.equal(readingConfirmation.proposal.referencedIntentProposalId, readingProposal.proposalId);

const backupProposal = pendingProposal(
  'issue91-live-backup-proposal',
  'Keep encrypted project backups on a removable drive and rotate it off-device weekly.',
);
const backupConfirmation = await solandra.cognition.interpret({
  conversationId: 'issue91-live-backup-confirmation',
  messageId: 'issue91-live-backup-confirmation-message',
  message: 'Right, you’ve got the change I meant.',
  currentObjective: 'Set up a simple backup routine for my local coding project.',
  recentUserMessages: [
    'Set up a simple backup routine for my local coding project.',
    'I meant an encrypted removable drive that I rotate off-device each week.',
  ],
  recentConversation: [
    { role: 'USER', content: 'Set up a simple backup routine for my local coding project.' },
    { role: 'USER', content: 'I meant an encrypted removable drive that I rotate off-device each week.' },
  ],
  governedKnowledge: [],
  governedRecommendations: [],
  pendingIntentProposal: backupProposal,
});
assertLiveProvenance(backupConfirmation);
assert.notEqual(backupConfirmation.mode, 'CONVERSATION');
assert.equal(backupConfirmation.proposal.requestedHelp, 'CONFIRM_INTENT');
assert.equal(backupConfirmation.proposal.referencedIntentProposalId, backupProposal.proposalId);

const cameraProposal = pendingProposal(
  'issue91-live-camera-proposal',
  'Compare compact cameras for low-light still photography.',
);
const cameraCorrection = await solandra.cognition.interpret({
  conversationId: 'issue91-live-camera-correction',
  messageId: 'issue91-live-camera-correction-message',
  message: 'No — I was changing it to low-light video, not still photos.',
  currentObjective: 'Compare compact cameras for travel photography.',
  recentUserMessages: [
    'Compare compact cameras for travel photography.',
    'Focus the comparison on low-light still photography.',
  ],
  recentConversation: [
    { role: 'USER', content: 'Compare compact cameras for travel photography.' },
    { role: 'USER', content: 'Focus the comparison on low-light still photography.' },
  ],
  governedKnowledge: [],
  governedRecommendations: [],
  pendingIntentProposal: cameraProposal,
});
assertLiveProvenance(cameraCorrection);
if (cameraCorrection.mode !== 'CONVERSATION') {
  assert.notEqual(cameraCorrection.proposal.requestedHelp, 'CONFIRM_INTENT');
}

const contextualMessages = [
  {
    messageId: 'issue91-live-context-option-message',
    content: 'For my reading nook, Birch folds flat while Moss stays assembled.',
  },
  {
    messageId: 'issue91-live-context-priority-message',
    content: 'I care most about being able to tuck it behind the closet door after reading.',
  },
  {
    messageId: 'issue91-live-context-followup-message',
    content: 'Which one better matches that priority?',
  },
];
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
  cases: [
    {
      id: 'ordinary-help',
      mode: ordinary.mode ?? 'GOVERNED',
      actualProvider: ordinary.invocationProvenance.actualProvider,
      actualModel: ordinary.invocationProvenance.actualModel,
      routeProvenance: ordinary.invocationProvenance.routeProvenance,
    },
    {
      id: 'natural-reading-confirmation',
      mode: readingConfirmation.mode ?? 'GOVERNED',
      requestedHelp: readingConfirmation.proposal.requestedHelp,
      referencedIntentProposalId: readingConfirmation.proposal.referencedIntentProposalId,
    },
    {
      id: 'natural-backup-confirmation',
      mode: backupConfirmation.mode ?? 'GOVERNED',
      requestedHelp: backupConfirmation.proposal.requestedHelp,
      referencedIntentProposalId: backupConfirmation.proposal.referencedIntentProposalId,
    },
    {
      id: 'natural-correction-not-confirmation',
      mode: cameraCorrection.mode ?? 'GOVERNED',
      requestedHelp: cameraCorrection.mode === 'CONVERSATION' ? null : cameraCorrection.proposal.requestedHelp,
    },
    {
      id: 'contextual-advisory-handoff',
      status: contextualAdvisory.result.status,
      userPremiseMessageIds: contextualAdvisory.result.status === 'RECOMMENDATION'
        ? contextualAdvisory.result.userPremiseMessageIds
        : [],
    },
  ],
}, null, 2));
console.log('ISSUE91_LIVE_SOLANDRA_COGNITION=PASS');