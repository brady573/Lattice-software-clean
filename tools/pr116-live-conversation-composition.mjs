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
  const result = await solandra.cognition.interpret({
    conversationId: `pr116-live-${entry.id}`,
    messageId: `pr116-live-${entry.id}-message`,
    message: entry.message,
    recentUserMessages: [],
    recentConversation: [],
    governedKnowledge: [],
    governedRecommendations: [],
  });

  assert.ok(isConversationalCognition(result), `${entry.id} must remain ordinary conversation cognition.`);
  assert.equal(result.invocationProvenance.actualProvider, 'groq');
  assert.equal(result.invocationProvenance.actualModel, 'openai/gpt-oss-120b');
  assert.equal(result.invocationProvenance.routeProvenance, 'COMPLETE');

  const presentation = conversationPresentationFor(result);
  assert.ok(presentation.conversationText.trim().length > 0, `${entry.id} requires Conversation content.`);
  assert.ok((presentation.composerBody?.trim().length ?? 0) > 0, `${entry.id} requires substantive Composer work.`);
  assert.notEqual(presentation.conversationText.trim(), presentation.composerBody?.trim());

  evidence.push({
    id: entry.id,
    mode: result.mode,
    conversationTextLength: presentation.conversationText.length,
    composerBodyLength: presentation.composerBody?.length ?? 0,
    actualProvider: result.invocationProvenance.actualProvider,
    actualModel: result.invocationProvenance.actualModel,
    routeProvenance: result.invocationProvenance.routeProvenance,
  });
}

console.log(JSON.stringify({ configuredModel: solandra.model, cases: evidence }, null, 2));
console.log('PR116_LIVE_CONVERSATION_COMPOSITION=PASS');
