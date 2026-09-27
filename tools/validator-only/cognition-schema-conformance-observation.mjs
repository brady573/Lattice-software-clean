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
/**
 * The live proof failure at this head was raised from a CONFIRM_INTENT call
 * with a supplied pending Intent proposal, not from an ordinary message. This
 * phase exercises that structural shape directly and reports the raw value the
 * model puts in knowledgePresentation, which the schema never includes in its
 * own error output.
 */
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

const CONFIRMATION_CASES = [
  {
    label: 'confirm_pending_proposal',
    currentObjective: 'Set up a simple backup routine for my local writing project.',
    proposalObjective: 'Keep encrypted project backups on a removable drive and rotate it off-device weekly.',
    message: 'Yes, that is exactly the change I meant.',
    recentUserMessages: [
      'Set up a simple backup routine for my local writing project.',
      'I meant an encrypted removable drive that I rotate off-device each week.',
    ],
  },
  {
    label: 'confirm_pending_proposal_second',
    currentObjective: 'Plan a quiet reading corner for my apartment.',
    proposalObjective: 'Plan a quiet reading corner that works in a shared living room without taking over the whole space.',
    message: 'That is right, go ahead with that version.',
    recentUserMessages: [
      'Plan a quiet reading corner for my apartment.',
      'Actually, make it work in the shared living room without taking over the whole space.',
    ],
  },
];

for (const [index, testCase] of CONFIRMATION_CASES.entries()) {
  currentCall = 100 + index;
  rawContent = null;
  const started = Date.now();
  try {
    const result = await cognition.interpret({
      conversationId: `validator-schema-${currentCall}`,
      messageId: `validator-schema-${currentCall}-message`,
      message: testCase.message,
      currentObjective: testCase.currentObjective,
      recentUserMessages: testCase.recentUserMessages,
      recentConversation: testCase.recentUserMessages.map((content) => ({ role: 'USER', content })),
      governedKnowledge: [],
      governedRecommendations: [],
      pendingIntentProposal: pendingProposal(
        `validator-schema-${currentCall}-proposal`,
        testCase.proposalObjective,
      ),
    });
    summarize(testCase.label, {
      outcome: 'parsed',
      mode: result.mode,
      requestedHelp: result.mode === 'GOVERNED' ? result.proposal.requestedHelp : null,
      knowledgePresentation: result.mode === 'GOVERNED'
        ? (result.proposal.knowledgePresentation === undefined ? 'ABSENT' : result.proposal.knowledgePresentation)
        : null,
      elapsed_s: Math.round((Date.now() - started) / 100) / 10,
    });
  } catch (error) {
    let observed = 'NO_RAW_CONTENT';
    let modelRequestedHelp = null;
    if (typeof rawContent === 'string') {
      try {
        const parsed = JSON.parse(rawContent);
        modelRequestedHelp = parsed?.projection?.requestedHelp ?? null;
        const value = parsed?.projection?.knowledgePresentation;
        observed = value === undefined ? 'ABSENT' : JSON.stringify(value);
      } catch {
        observed = 'RAW_NOT_JSON';
      }
    }
    summarize(testCase.label, {
      outcome: 'schema_rejected',
      errorCode: error?.code ?? null,
      errorMessage: String(error?.message ?? error).slice(0, 300),
      model_requestedHelp: modelRequestedHelp,
      model_knowledgePresentation: observed,
      elapsed_s: Math.round((Date.now() - started) / 100) / 10,
    });
    console.log(`RAW call=${currentCall} content=${JSON.stringify(rawContent)}`);
  }
}

console.log('PROBE_COMPLETE');