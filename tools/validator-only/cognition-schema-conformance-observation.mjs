/**
 * VALIDATOR-ONLY Solandra cognition schema-conformance observation. Not Product
 * code; not for merge.
 *
 * Question: when canonical Solandra cognition returns a completion that fails
 * the cognition schema, what exactly does the model return, and is the
 * deviation recurring or a one-off?
 *
 * Canonical composition throughout: GroqKnowledgeSimplifierModelProvider,
 * pinned model openai/gpt-oss-120b, shared memory recovery coordinator, Product
 * 30s attempt window, maxAttempts=2, per-attempt window policy.
 *
 * The provider's existing diagnosticSink (documented test/development
 * observability with no Product authority or response effect) is used to read
 * the raw completion text. No Product source file is modified and no
 * credential, credential-derived scope id, or authorization header is logged.
 */
import {
  MemoryGroqRateLimitCoordinator,
} from '../../src/model/groq-rate-limit-coordinator.ts';
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from '../../src/model/groq-knowledge-simplifier.ts';
import { ModelSolandraCognitiveRuntime } from '../../src/solandra/cognition.ts';

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) throw new Error('GROQ_API_KEY is required for this validator-only observation.');

const ATTEMPT_WINDOW_MS = 30_000;
const MAX_ATTEMPTS = 2;
const MAX_CALLS = 4;

let currentCall = 0;
let rawContent = null;

const provider = new GroqKnowledgeSimplifierModelProvider({
  apiKey: API_KEY,
  rateLimitCoordinator: new MemoryGroqRateLimitCoordinator(),
  // Existing no-authority observability hook: read the raw completion so the
  // actual invalid token is observable rather than inferred.
  diagnosticSink: (diagnostic) => {
    rawContent = diagnostic.content;
  },
});
const runtime = new GroqKnowledgeSimplifierModelRuntime(provider, ATTEMPT_WINDOW_MS);
const cognition = new ModelSolandraCognitiveRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL, MAX_ATTEMPTS);

const CASES = [
  // The exact Current USER message from the live cognition proof that failed at
  // this head with a cognition schema rejection, followed by fresh ordinary
  // cases. Reproducing a specific observed failure is the point here; this is
  // not a wording matrix.
  'I’m comparing two ways to keep a small local project recoverable. What tradeoffs should I think about?',
  'I am weighing two ways to keep a small home project recoverable. What tradeoffs should I think about?',
  'What is a sensible way to compare two backup services for a small business?',
  'Explain why some people find running errands early in the morning easier.',
];

function summarize(label, detail) {
  console.log(`SUMMARY ${JSON.stringify({ label, ...detail })}`);
}

for (let i = 0; i < Math.min(MAX_CALLS, CASES.length); i += 1) {
  currentCall = i + 1;
  rawContent = null;
  const started = Date.now();
  try {
    const result = await cognition.interpret({
      conversationId: `validator-schema-${currentCall}`,
      messageId: `validator-schema-${currentCall}-message`,
      message: CASES[i],
      recentUserMessages: [],
      recentConversation: [],
      governedKnowledge: [],
      governedRecommendations: [],
    });
    summarize(`call_${currentCall}`, {
      outcome: 'parsed',
      mode: result.mode,
      requestedHelp: result.mode === 'GOVERNED' ? result.proposal.requestedHelp : null,
      knowledgePresentation: result.mode === 'GOVERNED'
        ? result.proposal.knowledgePresentation ?? null
        : null,
      elapsed_s: Math.round((Date.now() - started) / 100) / 10,
    });
  } catch (error) {
    // The provider completed and the runtime returned; only the cognition
    // schema rejected it. Report the raw text so the deviation is concrete.
    let observedKnowledgePresentation = 'UNPARSABLE';
    if (typeof rawContent === 'string') {
      try {
        const parsed = JSON.parse(rawContent);
        const value = parsed?.projection?.knowledgePresentation;
        observedKnowledgePresentation = value === undefined ? 'ABSENT' : JSON.stringify(value);
      } catch {
        observedKnowledgePresentation = 'RAW_NOT_JSON';
      }
    }
    let mode = null;
    let requestedHelp = null;
    if (typeof rawContent === 'string') {
      try {
        const parsed = JSON.parse(rawContent);
        mode = parsed?.mode ?? null;
        requestedHelp = parsed?.projection?.requestedHelp ?? null;
      } catch { /* leave null */ }
    }
    summarize(`call_${currentCall}`, {
      outcome: 'schema_rejected',
      errorName: error?.name ?? null,
      errorCode: error?.code ?? null,
      errorMessage: String(error?.message ?? error).slice(0, 400),
      model_mode: mode,
      model_requestedHelp: requestedHelp,
      model_knowledgePresentation: observedKnowledgePresentation,
      elapsed_s: Math.round((Date.now() - started) / 100) / 10,
    });
    console.log(`RAW call=${currentCall} content=${JSON.stringify(rawContent)}`);
  }
}
console.log('PROBE_COMPLETE');
