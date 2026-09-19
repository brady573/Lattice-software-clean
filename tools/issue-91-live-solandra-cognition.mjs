import assert from 'node:assert/strict';
import { resolveRuntimeConfig } from '../src/runtime-config.ts';
import { projectAdvisoryTransientCognition } from '../src/solandra/advisory.ts';
import { establishConversationalRecommendation } from '../src/recommendation/recommendation-continuity.ts';
import { MemoryRecommendationStore } from '../src/recommendation/recommendation-store.ts';
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
    content: 'Make a recommendation I can come back to later. Which would you pick?',
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
const transientCognition = projectAdvisoryTransientCognition(contextualCognition.proposal);
assert.ok(
  transientCognition.proposedObjective
  || transientCognition.relevantContext.length > 0
  || transientCognition.entities.length > 0
  || transientCognition.referents.length > 0
  || transientCognition.preferences.length > 0
  || transientCognition.constraints.length > 0,
  'live cognition did not produce any transient semantic context for advisory handoff',
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

const telemetryMessage = {
  messageId: 'issue91-live-uncertainty-message',
  content: 'For a battery-powered trail sensor, should I poll every minute or every fifteen minutes? I care more about battery life than rapid updates. Use the supplied evidence, and explain what remains uncertain in your own words.',
};
const telemetryIntent = {
  intentScopeId: 'consultation:issue91-live-uncertainty',
  intentVersionId: 'issue91-live-uncertainty-v1',
  version: 1,
  predecessorIntentVersionId: null,
  transitionId: 'issue91-live-uncertainty-transition',
  lineageKind: 'INITIAL',
  lineageTargetIntentVersionId: null,
  state: {
    objective: {
      value: { state: 'VALUE', value: telemetryMessage.content },
      provenance: {
        kind: 'EXPLICIT_USER',
        logicalUserTurnId: 'issue91-live-uncertainty-turn',
        sourceMessageId: telemetryMessage.messageId,
        sourceDigest: 'c'.repeat(64),
      },
    },
    requirements: {},
    preferences: {},
  },
  createdAt: '2026-09-18T00:10:00.000Z',
};
const governedUncertainty = 'The battery-life gain for this exact sensor hardware has not been measured.';
const governedFinding = 'Longer polling intervals reduce the number of radio wakeups required for periodic telemetry.';
const advisoryKnowledge = {
  knowledgeId: 'issue91-live-uncertainty-knowledge',
  objective: telemetryMessage.content,
  findings: [{
    claimId: 'issue91-live-uncertainty-claim',
    text: governedFinding,
    status: 'SUPPORTED',
    confidence: 'HIGH',
  }],
  uncertainties: [governedUncertainty],
  asOf: '2026-09-18T00:09:00.000Z',
};
const knowledgeBackedAdvisory = await solandra.advisory.advise({
  conversationId: 'issue91-live-uncertainty',
  userMessageId: telemetryMessage.messageId,
  authoritativeIntent: telemetryIntent,
  authoritativeObjective: telemetryMessage.content,
  userContext: [telemetryMessage.content],
  userContextMessages: [telemetryMessage],
  knowledge: [advisoryKnowledge],
});
assertLiveProvenance(knowledgeBackedAdvisory);
assert.equal(knowledgeBackedAdvisory.result.status, 'RECOMMENDATION');
assert.equal('preservedUncertainties' in knowledgeBackedAdvisory.result, false);
assert.ok(knowledgeBackedAdvisory.result.uncertainties.length > 0, 'live advisory did not provide ordinary uncertainty explanation');
assert.ok(
  knowledgeBackedAdvisory.result.basis.some((entry) =>
    entry.knowledgeId === advisoryKnowledge.knowledgeId
    && entry.claimIds.includes(advisoryKnowledge.findings[0].claimId)),
  'live advisory did not select the supplied governed Knowledge/claim basis',
);

const sourceMessage = {
  conversationId: 'issue91-live-uncertainty',
  intentScopeId: telemetryIntent.intentScopeId,
  logicalUserTurnId: 'issue91-live-uncertainty-turn',
  messageId: telemetryMessage.messageId,
  messageHorizon: 1,
  content: telemetryMessage.content,
  origin: 'USER',
  contentDigest: 'c'.repeat(64),
  createdAt: telemetryIntent.createdAt,
};
const liveStore = new MemoryRecommendationStore();
let durableRecommendation;
try {
  durableRecommendation = await establishConversationalRecommendation({
    store: liveStore,
    conversationId: sourceMessage.conversationId,
    intentVersion: telemetryIntent,
    sourceMessage,
    userMessages: [sourceMessage],
    knowledge: [{
      record: {
        knowledgeId: advisoryKnowledge.knowledgeId,
        conversationId: sourceMessage.conversationId,
        runId: 'issue91-live-uncertainty-knowledge-run',
        intentScopeId: telemetryIntent.intentScopeId,
        intentVersionId: telemetryIntent.intentVersionId,
        sourceMessageId: sourceMessage.messageId,
        objective: telemetryMessage.content,
        claimIds: [advisoryKnowledge.findings[0].claimId],
        sourceIds: [],
        evidenceIds: [],
        truthAssessmentIds: [],
        uncertainties: [governedUncertainty],
        asOf: advisoryKnowledge.asOf,
        createdAt: advisoryKnowledge.asOf,
      },
      run: { id: 'issue91-live-uncertainty-knowledge-run' },
      truth: {},
      knowledge: {
        findings: [{
          ...advisoryKnowledge.findings[0],
          evidenceIds: [],
          contradictoryEvidenceIds: [],
          temporalQualifiers: { effectiveAt: null, period: null },
          basis: 'CLAIM',
        }],
        uncertainties: [governedUncertainty],
        provenance: [],
        evidence: [],
      },
    }],
    advisory: knowledgeBackedAdvisory.result,
  });
} finally {
  await liveStore.close();
}
assert.deepEqual(durableRecommendation.uncertainties, [governedUncertainty]);
assert.deepEqual(durableRecommendation.rationale, [governedFinding]);
assert.notDeepEqual(durableRecommendation.uncertainties, knowledgeBackedAdvisory.result.uncertainties);

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
  governedUncertainty: {
    advisoryStatus: knowledgeBackedAdvisory.result.status,
    modelUncertainties: knowledgeBackedAdvisory.result.status === 'RECOMMENDATION'
      ? knowledgeBackedAdvisory.result.uncertainties
      : [],
    durableUncertainties: durableRecommendation.uncertainties,
    durableRationale: durableRecommendation.rationale,
  },
}, null, 2));
console.log('ISSUE91_LIVE_SOLANDRA_COGNITION=PASS');
