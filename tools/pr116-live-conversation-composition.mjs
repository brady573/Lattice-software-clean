import assert from 'node:assert/strict';
import { resolveRuntimeConfig } from '../src/runtime-config.ts';
import { requireConfiguredSolandraCognition } from '../src/solandra/cognition-composition.ts';
import { conversationPresentationFor, isConversationalCognition } from '../src/solandra/cognition.ts';

const config = resolveRuntimeConfig({
  LATTICE_DEPLOYMENT_MODE: 'development',
  LATTICE_TRUTH_MODE: 'v36-offline',
  LATTICE_AUTHENTICATION_MODE: 'development-fixture',
  LATTICE_DEVELOPMENT_FIXTURE_SUBJECT_ID: 'pr116-live-composition',
  LATTICE_SOLANDRA_COGNITION_ROUTE: 'groq-gpt-oss-120b',
  GROQ_API_KEY: process.env.GROQ_API_KEY,
});
const solandra = requireConfiguredSolandraCognition(config);
assert.equal(solandra.model, 'openai/gpt-oss-120b');

const cases = [
  {
    id: 'cat6-canary',
    message: 'Give me instructions on how to setup a cat6 patch panel in my house',
  },
  {
    id: 'moving-checklist',
    message: 'Make me a detailed moving-day checklist for relocating from one apartment to another without forgetting the practical handoff tasks.',
  },
  {
    id: 'piano-practice-plan',
    message: 'Create a four-week practice plan for learning a short piano piece, with a clear focus for each week and concrete practice tasks.',
  },
];

const evidence = [];
for (const entry of cases) {
  try {
    const result = await solandra.cognition.interpret({
      conversationId: `pr116-live-${entry.id}`,
      messageId: `pr116-live-${entry.id}-message`,
      message: entry.message,
      recentUserMessages: [],
      recentConversation: [],
      governedKnowledge: [],
      governedRecommendations: [],
    });

    const conversational = isConversationalCognition(result);
    const provenanceComplete = result.invocationProvenance.actualProvider === 'groq'
      && result.invocationProvenance.actualModel === 'openai/gpt-oss-120b'
      && result.invocationProvenance.routeProvenance === 'COMPLETE';
    const presentation = conversational ? conversationPresentationFor(result) : null;
    const conversationText = presentation?.conversationText?.trim() ?? '';
    const composerBody = presentation?.composerBody?.trim() ?? '';
    const pass = conversational
      && provenanceComplete
      && conversationText.length > 0
      && composerBody.length > 0
      && conversationText !== composerBody;

    evidence.push({
      id: entry.id,
      pass,
      mode: result.mode,
      conversationText,
      composerBody,
      conversationTextLength: conversationText.length,
      composerBodyLength: composerBody.length,
      actualProvider: result.invocationProvenance.actualProvider,
      actualModel: result.invocationProvenance.actualModel,
      routeProvenance: result.invocationProvenance.routeProvenance,
    });
  } catch (error) {
    evidence.push({
      id: entry.id,
      pass: false,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : null,
    });
  }
}

console.log(JSON.stringify({ configuredModel: solandra.model, cases: evidence }, null, 2));
const failed = evidence.filter((entry) => entry.pass !== true);
if (failed.length > 0) {
  throw new Error(`PR116 live two-surface composition failed ${failed.length} of ${evidence.length} cases: ${failed.map((entry) => entry.id).join(', ')}`);
}
console.log('PR116_LIVE_CONVERSATION_COMPOSITION=PASS');
