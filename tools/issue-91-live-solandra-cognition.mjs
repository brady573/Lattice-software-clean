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

const result = await solandra.cognition.interpret({
  conversationId: 'issue91-live-cognition',
  messageId: 'issue91-live-cognition-message',
  message: 'I’m comparing two ways to keep a small local project recoverable. What tradeoffs should I think about?',
  recentUserMessages: [],
  recentConversation: [],
  governedKnowledge: [],
  governedRecommendations: [],
});

assert.equal(result.invocationProvenance.actualProvider, 'groq');
assert.equal(result.invocationProvenance.actualModel, 'openai/gpt-oss-120b');
assert.equal(result.invocationProvenance.routeProvenance, 'COMPLETE');

console.log(JSON.stringify({
  configuredModel: solandra.model,
  resultMode: result.mode ?? 'GOVERNED',
  actualProvider: result.invocationProvenance.actualProvider,
  actualModel: result.invocationProvenance.actualModel,
  routeProvenance: result.invocationProvenance.routeProvenance,
}, null, 2));
console.log('ISSUE91_LIVE_SOLANDRA_COGNITION=PASS');
