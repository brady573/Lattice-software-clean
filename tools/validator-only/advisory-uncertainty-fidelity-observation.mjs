/**
 * VALIDATOR-ONLY Solandra advisory uncertainty-fidelity observation.
 * Not Product code; not for merge.
 *
 * Question: when the advisory fidelity guard reports that reasoning
 * "invented an uncertainty reference that was not supplied by Lattice", what
 * exactly did the model put in preservedUncertainties, and is the deviation a
 * paraphrase of supplied uncertainty, a formatting variant, or an unrelated
 * fabrication?
 *
 * The guard compares preservedUncertainties against the supplied uncertainty
 * strings by exact set membership, so the distinction between those cases
 * cannot be recovered from the failure itself. This observation captures the
 * raw completion and classifies each non-matching entry.
 *
 * Canonical composition: GroqKnowledgeSimplifierModelProvider, pinned model
 * openai/gpt-oss-120b, shared memory recovery coordinator, Product 30s attempt
 * window, maxAttempts=2, per-attempt window policy. The provider's existing
 * no-authority diagnosticSink is used to read the raw completion. No Product
 * source file is modified and no credential, credential-derived scope id, or
 * authorization header is logged.
 */
import {
  MemoryGroqRateLimitCoordinator,
} from '../../src/model/groq-rate-limit-coordinator.ts';
import {
  GROQ_KNOWLEDGE_SIMPLIFIER_MODEL,
  GroqKnowledgeSimplifierModelProvider,
  GroqKnowledgeSimplifierModelRuntime,
} from '../../src/model/groq-knowledge-simplifier.ts';
import {
  ModelSolandraAdvisoryRuntime,
} from '../../src/solandra/advisory.ts';

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) throw new Error('GROQ_API_KEY is required for this validator-only observation.');

const ATTEMPT_WINDOW_MS = 30_000;
const MAX_ATTEMPTS = 2;

// Governed uncertainty strings of the kind the truth pipeline actually produces:
// natural-language sentences, not short identifiers. The model is asked to copy
// these verbatim.
const SUPPLIED_UNCERTAINTIES = [
  "The comparison depends on maintenance cost figures that were not independently verified for the candidate approaches.",
  "Evidence about long-term reliability is limited to a single reporting period and may not generalise to other deployments.",
];

const USER_MESSAGE = "Help me decide between a small monthly subscription and a one-off purchase for my photo backups.";

// The advisory boundary may make more than one model call (the recommendation
// itself, then a grounding audit with its own GROUNDED vocabulary). Collect every
// completion so the recommendation is not lost behind a later one.
const rawCompletions = [];
const provider = new GroqKnowledgeSimplifierModelProvider({
  apiKey: API_KEY,
  rateLimitCoordinator: new MemoryGroqRateLimitCoordinator(),
  diagnosticSink: (diagnostic) => {
    rawCompletions.push(diagnostic.content);
  },
});
const runtime = new GroqKnowledgeSimplifierModelRuntime(provider, ATTEMPT_WINDOW_MS);
const advisory = new ModelSolandraAdvisoryRuntime(runtime, GROQ_KNOWLEDGE_SIMPLIFIER_MODEL, MAX_ATTEMPTS);

const input = {
  conversationId: 'validator-advisory-uncertainty',
  userMessageId: 'validator-advisory-uncertainty-message',
  authoritativeIntent: {
    intentScopeId: 'consultation:validator-advisory',
    intentVersionId: 'intent-validator-advisory-v1',
    version: 1,
    predecessorIntentVersionId: null,
    transitionId: 'transition-validator-advisory-v1',
    lineageKind: 'INITIAL',
    lineageTargetIntentVersionId: null,
    state: {
      objective: {
        value: { state: 'VALUE', value: USER_MESSAGE },
        provenance: {
          kind: 'EXPLICIT_USER',
          state: 'VALUE',
          value: { value: USER_MESSAGE, origin: 'USER_MESSAGE', userMessageId: 'validator-advisory-uncertainty-message' },
        },
      },
    },
    createdAt: '2026-09-27T00:00:00.000Z',
  },
  authoritativeObjective: USER_MESSAGE,
  userContext: [USER_MESSAGE],
  knowledge: [{
    knowledgeId: 'knowledge-validator-advisory',
    objective: USER_MESSAGE,
    findings: [{
      claimId: 'claim-validator-advisory-1',
      text: 'Recurring subscription cost continues for as long as the subscription remains active.',
      status: 'SUPPORTED',
      confidence: 'HIGH',
    }],
    uncertainties: SUPPLIED_UNCERTAINTIES,
    asOf: '2026-09-27T00:00:00.000Z',
  }],
};

function normalise(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function lower(value) {
  return normalise(value).toLowerCase();
}

/** Classifies one preservedUncertainties entry against the supplied strings. */
function classify(entry) {
  if (SUPPLIED_UNCERTAINTIES.includes(entry)) return { match: 'EXACT' };
  if (SUPPLIED_UNCERTAINTIES.some((u) => normalise(u) === normalise(entry))) return { match: 'WHITESPACE' };
  if (SUPPLIED_UNCERTAINTIES.some((u) => lower(u) === lower(entry))) return { match: 'CASE_OR_PUNCTUATION' };

  // Token-overlap heuristic: a paraphrase keeps most content words.
  const tokens = new Set(lower(entry).split(/[^a-z0-9]+/).filter((t) => t.length > 3));
  const scores = SUPPLIED_UNCERTAINTIES.map((u) => {
    const suppliedTokens = new Set(lower(u).split(/[^a-z0-9]+/).filter((t) => t.length > 3));
    let shared = 0;
    for (const token of tokens) if (suppliedTokens.has(token)) shared += 1;
    return { supplied: u, ratio: tokens.size === 0 ? 0 : shared / tokens.size };
  });
  scores.sort((a, b) => b.ratio - a.ratio);
  const best = scores[0];
  if (best.ratio >= 0.6) return { match: 'PARAPHRASE', overlap: Math.round(best.ratio * 100) / 100 };
  if (best.ratio >= 0.3) return { match: 'RELATED_REWORD', overlap: Math.round(best.ratio * 100) / 100 };
  return { match: 'UNRELATED', overlap: Math.round(best.ratio * 100) / 100 };
}

const started = Date.now();
let outcome = null;
try {
  const result = await advisory.advise(input);
  outcome = { outcome: 'accepted', status: result.result.status };
} catch (error) {
  outcome = {
    outcome: 'rejected',
    code: error?.code ?? null,
    message: String(error?.message ?? error).slice(0, 300),
  };
}
console.log(`SUMMARY ${JSON.stringify({ ...outcome, completions: rawCompletions.length, elapsed_s: Math.round((Date.now() - started) / 100) / 10 })}`);

if (rawCompletions.length === 0) {
  console.log('RAW content=null (the provider did not complete)');
  console.log('PROBE_COMPLETE');
} else {
  for (const [callIndex, content] of rawCompletions.entries()) {
    console.log(`RAW call=${callIndex} content=${JSON.stringify(content)}`);
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.log(`MODEL_JSON call=${callIndex} NOT_PARSEABLE`);
    }
    if (parsed === null) continue;
    console.log(`MODEL_STATUS call=${callIndex} ${JSON.stringify(parsed.status ?? null)}`);
    const preserved = Array.isArray(parsed.preservedUncertainties) ? parsed.preservedUncertainties : null;
    console.log(`PRESERVED_COUNT call=${callIndex} ${JSON.stringify(preserved === null ? null : preserved.length)}`);
    if (preserved !== null) {
      for (const [index, entry] of preserved.entries()) {
        const verdict = typeof entry === 'string'
          ? classify(entry)
          : { match: 'NOT_A_STRING', type: typeof entry };
        console.log(`ENTRY call=${callIndex} ${JSON.stringify({ index, verdict, value: entry })}`);
      }
    }
    if (parsed.uncertainties !== undefined) {
      console.log(`ADVISORY_UNCERTAINTIES call=${callIndex} ${JSON.stringify(parsed.uncertainties)}`);
    }
  }
}
console.log('PROBE_COMPLETE');
