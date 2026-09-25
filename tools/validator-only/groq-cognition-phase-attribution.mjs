/**
 * VALIDATOR-ONLY phase attribution probe. Not Product code; not for merge.
 *
 * Question: when Solandra cognition times out, is the attempt consumed BEFORE
 * the Groq HTTP request (shared rate-limit recovery wait) or AFTER the fetch
 * has actually started?
 *
 * Composition is canonical: GroqKnowledgeSimplifierModelProvider, pinned model
 * openai/gpt-oss-120b, shared-memory Groq rate-limit coordinator, Product 30s
 * attempt window, maxAttempts=2, reasoning_effort=low (provider-pinned),
 * attemptWindowPolicy per-attempt (cognition-pinned).
 *
 * Only observation wrappers are added, through the provider's existing
 * injectable fetchImpl / rateLimitCoordinator options. No Product source file is
 * modified. No credential, credential-derived scope id, digest, or
 * authorization header is ever logged.
 */
import {
  MemoryGroqRateLimitCoordinator,
  groqRateLimitScopeId,
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
const MAX_CALLS = 4;
const MAX_ATTEMPTS = 2;

const t0All = Date.now();
let callIndex = 0;
let currentAttempt = -1;

function emit(event, fields = {}) {
  const extra = Object.entries(fields).map(([k, v]) => ` ${k}=${v}`).join('');
  const t = Date.now() - t0All;
  console.log(`PHASE call=${callIndex} attempt=${currentAttempt} t_ms=${t} event=${event}${extra}`);
}

function summarize(label, detail) {
  console.log(`SUMMARY ${JSON.stringify({ label, ...detail })}`);
}

/** Wraps the canonical shared coordinator. Logs wait duration only, never scope ids. */
class ObservedCoordinator {
  constructor(inner) {
    this.inner = inner;
    this.kind = inner.kind;
  }

  async blockedUntil(scopeId, signal) {
    return this.inner.blockedUntil(scopeId, signal);
  }

  async extendBlockedUntil(scopeId, blockedUntilMs, signal) {
    const result = await this.inner.extendBlockedUntil(scopeId, blockedUntilMs, signal);
    emit('COORDINATOR_EXTEND_BLOCKED');
    return result;
  }

  async waitUntilReady(scopeId, signal) {
    const before = Date.now();
    const alreadyBlockedUntil = await this.inner.blockedUntil(scopeId, signal);
    emit('COORDINATOR_CHECK_START', {
      blocked_for_ms: Math.max(0, alreadyBlockedUntil - Date.now()),
    });
    try {
      await this.inner.waitUntilReady(scopeId, signal);
      emit('COORDINATOR_READY', { waited_ms: Date.now() - before });
    } catch (error) {
      emit('COORDINATOR_WAIT_ABORTED', {
        waited_ms: Date.now() - before,
        signal_aborted: String(signal.aborted === true),
      });
      throw error;
    }
  }

  async close() {
    return this.inner.close();
  }
}

/** Wraps the canonical HTTP call. Records only phase, status, and elapsed. */
const observedFetch = async (input, init) => {
  const t0 = Date.now();
  emit('HTTP_FETCH_START');
  try {
    const response = await fetch(input, init);
    emit('HTTP_RESPONSE_HEADERS', {
      status: response.status,
      headers_ms: Date.now() - t0,
    });
    const body = await response.clone().text().catch(() => '');
    emit('HTTP_RESPONSE_COMPLETE', {
      total_ms: Date.now() - t0,
      bytes: body.length,
    });
    return response;
  } catch (error) {
    emit('HTTP_FETCH_THROW', {
      elapsed_ms: Date.now() - t0,
      signal_aborted: String(init?.signal?.aborted === true),
    });
    throw error;
  }
};

/** Wraps the canonical provider to attribute phases to a specific attempt. */
function buildObservedProvider(inner) {
  return {
    kind: inner.kind,
    async generate(request, context) {
      currentAttempt = context.attempt;
      emit('ATTEMPT_START', { model: request.model });
      try {
        const result = await inner.generate(request, context);
        emit('ATTEMPT_RESULT', { outcome: 'provider_result' });
        return result;
      } catch (error) {
        emit('ATTEMPT_ERROR', {
          code: error?.code ?? 'unknown',
          message: String(error?.message ?? error),
        });
        throw error;
      }
    },
  };
}

function buildCognition(coordinatorInner) {
  const provider = buildObservedProvider(
    new GroqKnowledgeSimplifierModelProvider({
      apiKey: API_KEY,
      fetchImpl: observedFetch,
      rateLimitCoordinator: new ObservedCoordinator(coordinatorInner),
    }),
  );
  const runtime = new GroqKnowledgeSimplifierModelRuntime(provider, ATTEMPT_WINDOW_MS);
  return new ModelSolandraCognitiveRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL, MAX_ATTEMPTS);
}

function ordinaryInput(index, message) {
  return {
    conversationId: `validator-probe-${index}`,
    messageId: `validator-probe-${index}-message`,
    message,
    recentUserMessages: [],
    recentConversation: [],
    governedKnowledge: [],
    governedRecommendations: [],
  };
}

/* ------------------------------------------------------------------ *
 * Phase 1: attribution sequence. Fresh coordinator (no pre-existing
 * block), so any wait observed is genuinely Product-driven.
 * ------------------------------------------------------------------ */
const CASES = [
  'My bike chain skips when I change gear uphill. How do I work out what is actually wrong?',
  'We are moving house in autumn. What should I sort out first so nothing gets lost?',
  'My phone battery drops overnight while it is idle. How should I narrow down why?',
  'I want to keep a shared shopping list tidy between four people. How would you suggest we do that?',
];

async function attributionSequence() {
  const cognition = buildCognition(new MemoryGroqRateLimitCoordinator());
  for (let i = 0; i < Math.min(MAX_CALLS, CASES.length); i += 1) {
    callIndex = i + 1;
    currentAttempt = -1;
    const started = Date.now();
    try {
      const result = await cognition.interpret(ordinaryInput(callIndex, CASES[i]));
      summarize(`call_${callIndex}`, {
        outcome: 'success',
        mode: result.mode,
        elapsed_s: Math.round((Date.now() - started) / 100) / 10,
      });
    } catch (error) {
      summarize(`call_${callIndex}`, {
        outcome: 'failure',
        code: error?.code ?? null,
        message: String(error?.message ?? error),
        elapsed_s: Math.round((Date.now() - started) / 100) / 10,
      });
      console.log('DECISION: a Product-like cognition failure was observed; stopping the sequence.');
      return;
    }
  }
  console.log('DECISION: bounded sequence completed without reproducing the condition.');
}

/* ------------------------------------------------------------------ *
 * Phase 2: error-classification control. Does a coordinator recovery
 * wait that reaches the Product attempt deadline surface externally as
 * the generic timeout message? Pre-seeded blocked state, own
 * coordinator instance, no HTTP request expected.
 * ------------------------------------------------------------------ */
async function recoveryWaitCollapseControl() {
  callIndex = 0;
  currentAttempt = -1;
  const coordinatorInner = new MemoryGroqRateLimitCoordinator();
  const scopeId = groqRateLimitScopeId(API_KEY, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL);
  await coordinatorInner.extendBlockedUntil(scopeId, Date.now() + 120_000);
  console.log('PHASE call=0 attempt=-1 event=CONTROL_SEEDED_BLOCKED_STATE blocked_for_ms=120000');
  const cognition = buildCognition(coordinatorInner);
  const started = Date.now();
  try {
    await cognition.interpret(
      ordinaryInput(0, 'Give me a quick sanity check that the queue is behaving.'),
    );
    summarize('recovery_wait_collapse', {
      unexpected: 'cognition succeeded despite a seeded recovery block',
    });
  } catch (error) {
    const message = String(error?.message ?? error);
    summarize('recovery_wait_collapse', {
      code: error?.code ?? null,
      message,
      elapsed_s: Math.round((Date.now() - started) / 100) / 10,
      message_is_generic_timeout: /exceeded its timeout/i.test(message),
      exposes_recovery_boundary: /rate limit|recovery|coordinator|blocked/i.test(message),
    });
  }
}

await attributionSequence();
await recoveryWaitCollapseControl();
console.log('PROBE_COMPLETE');
